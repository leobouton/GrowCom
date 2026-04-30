import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';
import { userRepository } from '../repositories/user.repository';
import { tenantRepository } from '../repositories/tenant.repository';
import { prisma } from '../config/prisma';
import { AppError } from '../middlewares/errorHandler';
import { emailService } from '../integrations/email.service';
import { stripeService } from '../integrations/stripe.service';
import { UserRole } from '../../../shared/types';
import type { User } from '@prisma/client';

const SALT_ROUNDS = 12;

function generateAccessToken(user: User): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
    },
    env.JWT_ACCESS_SECRET,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { expiresIn: env.JWT_ACCESS_EXPIRY as any },
  );
}

function generateRefreshToken(): string {
  return crypto.randomBytes(64).toString('hex');
}

export const authService = {
  async register(data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    companyName: string;
    companySlug: string;
  }) {
    // Vérifier que l'email n'existe pas déjà
    const existing = await userRepository.findByEmail(data.email.toLowerCase());
    if (existing) {
      throw new AppError(409, 'EMAIL_TAKEN', 'Cet email est déjà utilisé');
    }

    // Vérifier que le slug n'existe pas déjà
    const existingTenant = await tenantRepository.findBySlug(data.companySlug);
    if (existingTenant) {
      throw new AppError(409, 'SLUG_TAKEN', 'Ce nom d\'entreprise est déjà pris');
    }

    const passwordHash = await bcrypt.hash(data.password, SALT_ROUNDS);

    // Créer le tenant et l'utilisateur dans une transaction
    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: data.companyName,
          slug: data.companySlug,
        },
      });

      const verificationToken = crypto.randomBytes(32).toString('hex');
      const verificationTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24h

      const user = await tx.user.create({
        data: {
          email: data.email.toLowerCase(),
          passwordHash,
          firstName: data.firstName,
          lastName: data.lastName,
          role: UserRole.MANAGER,
          tenantId: tenant.id,
          emailVerified: false,
          inviteToken: verificationToken,
          inviteTokenExpiry: verificationTokenExpiry,
        },
      });

      return { tenant, user };
    });

    // Envoyer l'email de vérification en arrière-plan (ne pas bloquer le register)
    emailService.sendEmailVerification(data.email, data.firstName, result.user.inviteToken!).catch(() => {
      // Log géré dans emailService
    });

    // Créer le customer Stripe en arrière-plan
    stripeService.createCustomer(result.tenant.id, data.email, data.companyName).catch(() => {
      // Log géré dans stripeService
    });

    const accessToken = generateAccessToken(result.user);
    const refreshTokenValue = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: result.user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: result.user.id,
        email: result.user.email,
        firstName: result.user.firstName,
        lastName: result.user.lastName,
        role: result.user.role,
        tenantId: result.user.tenantId,
        isActive: result.user.isActive,
        emailVerified: result.user.emailVerified,
        createdAt: result.user.createdAt.toISOString(),
      },
    };
  },

  async login(email: string, password: string) {
    const user = await userRepository.findByEmail(email.toLowerCase());
    if (!user || !user.isActive) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Email ou mot de passe incorrect');
    }

    const accessToken = generateAccessToken(user);
    const refreshTokenValue = generateRefreshToken();

    // Supprimer les anciens refresh tokens avant d'en créer un nouveau
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });

    await prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        createdAt: user.createdAt.toISOString(),
      },
    };
  },

  async refreshToken(token: string) {
    const stored = await prisma.refreshToken.findUnique({ where: { token } });
    if (!stored || stored.expiresAt < new Date()) {
      if (stored) {
        await prisma.refreshToken.delete({ where: { token } });
      }
      throw new AppError(401, 'REFRESH_TOKEN_INVALID', 'Session expirée, veuillez vous reconnecter');
    }

    const user = await userRepository.findById(stored.userId);
    if (!user || !user.isActive) {
      throw new AppError(401, 'USER_NOT_FOUND', 'Utilisateur introuvable');
    }

    // Rotation du refresh token
    await prisma.refreshToken.delete({ where: { token } });

    const newAccessToken = generateAccessToken(user);
    const newRefreshToken = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        token: newRefreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return { accessToken: newAccessToken, refreshToken: newRefreshToken };
  },

  async logout(refreshToken: string): Promise<void> {
    await prisma.refreshToken.deleteMany({ where: { token: refreshToken } });
  },

  async inviteCommercial(
    managerTenantId: string,
    managerId: string,
    email: string,
    firstName: string,
    lastName: string,
    role: UserRole = UserRole.COMMERCIAL,
    fixedSalary: number = 0,
  ) {
    const existing = await userRepository.findByEmail(email.toLowerCase());
    if (existing) {
      // Si l'utilisateur existe mais est inactif ET appartient au même tenant, on le supprime pour permettre la ré-invitation
      if (!existing.isActive && existing.tenantId === managerTenantId) {
        await userRepository.hardDelete(existing.id);
      } else {
        throw new AppError(409, 'EMAIL_TAKEN', 'Cet email est déjà utilisé');
      }
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

    // Trouver le groupe à assigner automatiquement selon le rôle de l'invitant
    const inviter = await userRepository.findById(managerId);
    let autoGroupId: string | null = null;

    if (inviter) {
      if (inviter.role === UserRole.TEAM_LEAD) {
        // Le responsable de secteur assigne au groupe dont il est lead
        const group = await prisma.group.findFirst({
          where: { leadId: managerId, tenantId: managerTenantId },
          select: { id: true },
        });
        autoGroupId = group?.id ?? null;
      } else if (inviter.role === UserRole.MANAGER || inviter.role === UserRole.BU_MANAGER) {
        // Le manager assigne au premier groupe dont il est responsable
        const group = await prisma.group.findFirst({
          where: { managerId, tenantId: managerTenantId },
          select: { id: true },
          orderBy: { createdAt: 'asc' },
        });
        autoGroupId = group?.id ?? null;
      }
    }

    const user = await userRepository.create({
      email: email.toLowerCase(),
      passwordHash: '',
      firstName,
      lastName,
      role,
      fixedSalary,
      tenantId: managerTenantId,
      inviteToken,
      inviteTokenExpiry,
      ...(autoGroupId ? { groupId: autoGroupId } : {}),
    });

    await emailService.sendInvitation(email, firstName, inviteToken);

    return user;
  },

  async resendInvitation(memberId: string, tenantId: string): Promise<void> {
    const user = await userRepository.findById(memberId);
    if (!user || user.tenantId !== tenantId) {
      throw new AppError(404, 'USER_NOT_FOUND', 'Collaborateur introuvable');
    }
    if (user.emailVerified) {
      throw new AppError(400, 'ALREADY_ACTIVE', 'Ce collaborateur a déjà activé son compte');
    }

    const inviteToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

    await prisma.user.update({
      where: { id: user.id },
      data: { inviteToken, inviteTokenExpiry },
    });

    await emailService.sendInvitation(user.email, user.firstName, inviteToken);
  },

  async forgotPassword(email: string): Promise<void> {
    const user = await userRepository.findByEmail(email.toLowerCase());
    // On ne révèle pas si l'email existe ou non (sécurité)
    if (!user || !user.isActive) return;

    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1h

    await prisma.user.update({
      where: { id: user.id },
      data: { resetToken, resetTokenExpiry },
    });

    await emailService.sendPasswordReset(user.email, user.firstName, resetToken);
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const user = await userRepository.findByResetToken(token);
    if (!user) {
      throw new AppError(404, 'RESET_TOKEN_INVALID', 'Lien de réinitialisation invalide');
    }

    if (!user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
      throw new AppError(410, 'RESET_TOKEN_EXPIRED', 'Ce lien a expiré, veuillez refaire une demande');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetToken: null, resetTokenExpiry: null },
    });

    // Invalider toutes les sessions existantes
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  },

  async verifyManagerEmail(token: string): Promise<void> {
    const user = await userRepository.findByInviteToken(token);
    if (!user) {
      throw new AppError(404, 'VERIFY_TOKEN_INVALID', 'Lien de vérification invalide ou déjà utilisé');
    }
    if (!user.inviteTokenExpiry || user.inviteTokenExpiry < new Date()) {
      throw new AppError(410, 'VERIFY_TOKEN_EXPIRED', 'Ce lien de vérification a expiré');
    }
    // Ne vérifier que les managers (les commerciaux utilisent acceptInvitation)
    if (user.role !== UserRole.MANAGER && user.role !== UserRole.BU_MANAGER) {
      throw new AppError(400, 'INVALID_ROLE', 'Ce lien n\'est pas valide pour ce type de compte');
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, inviteToken: null, inviteTokenExpiry: null },
    });
  },

  async acceptInvitation(token: string, password: string) {
    const user = await userRepository.findByInviteToken(token);
    if (!user) {
      throw new AppError(404, 'INVITE_NOT_FOUND', 'Lien d\'invitation invalide');
    }

    if (!user.inviteTokenExpiry || user.inviteTokenExpiry < new Date()) {
      throw new AppError(410, 'INVITE_EXPIRED', 'Ce lien d\'invitation a expiré');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        emailVerified: true,
        inviteToken: null,
        inviteTokenExpiry: null,
      },
    });

    const accessToken = generateAccessToken(updatedUser);
    const refreshTokenValue = generateRefreshToken();

    await prisma.refreshToken.create({
      data: {
        token: refreshTokenValue,
        userId: updatedUser.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenValue,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        firstName: updatedUser.firstName,
        lastName: updatedUser.lastName,
        role: updatedUser.role,
        tenantId: updatedUser.tenantId,
        isActive: updatedUser.isActive,
        emailVerified: updatedUser.emailVerified,
        createdAt: updatedUser.createdAt.toISOString(),
      },
    };
  },
};

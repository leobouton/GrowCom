import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import { userRepository } from '../repositories/user.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { env } from '../config/env';
import { UserRole } from '../../../shared/types';

const REFRESH_COOKIE = 'refresh_token';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

const registerSchema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
  firstName: z.string().min(1, 'Prénom requis').max(50),
  lastName: z.string().min(1, 'Nom requis').max(50),
  companyName: z.string().min(1, 'Nom de l\'entreprise requis').max(100),
  companySlug: z
    .string()
    .min(2, 'Le slug doit faire au moins 2 caractères')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Le slug ne peut contenir que des lettres minuscules, chiffres et tirets'),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const inviteSchema = z.object({
  email: z.string().email('Email invalide'),
  firstName: z.string().min(1, 'Prénom requis').max(50),
  lastName: z.string().min(1, 'Nom requis').max(50),
  role: z.enum([UserRole.COMMERCIAL, UserRole.RECRUITER, UserRole.BU_MANAGER]).default(UserRole.COMMERCIAL),
  fixedSalary: z.number().min(0).default(0),
});

const acceptInviteSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
});

const forgotPasswordSchema = z.object({
  email: z.string().email('Email invalide'),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Le mot de passe doit faire au moins 8 caractères'),
});

export const authController = {
  async register(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const data = registerSchema.parse(req.body);
      const result = await authService.register(data);

      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      res.status(201).json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async login(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email, password } = loginSchema.parse(req.body);
      const result = await authService.login(email, password);

      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies[REFRESH_COOKIE] as string | undefined;
      if (!refreshToken) {
        res.status(401).json({
          success: false,
          error: { code: 'NO_REFRESH_TOKEN', message: 'Session expirée' },
        });
        return;
      }

      const result = await authService.refreshToken(refreshToken);
      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      res.json({
        success: true,
        data: { accessToken: result.accessToken },
      });
    } catch (err) {
      next(err);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const refreshToken = req.cookies[REFRESH_COOKIE] as string | undefined;
      if (refreshToken) {
        await authService.logout(refreshToken);
      }
      res.clearCookie(REFRESH_COOKIE);
      res.json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  async inviteCommercial(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const data = inviteSchema.parse(req.body);

      const invited = await authService.inviteCommercial(
        user.tenantId!,
        user.userId,
        data.email,
        data.firstName,
        data.lastName,
        data.role,
        data.fixedSalary,
      );

      res.status(201).json({
        success: true,
        data: {
          id: invited.id,
          email: invited.email,
          firstName: invited.firstName,
          lastName: invited.lastName,
          role: invited.role,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async acceptInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = acceptInviteSchema.parse(req.body);
      const result = await authService.acceptInvitation(token, password);

      res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
      res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          user: result.user,
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { email } = forgotPasswordSchema.parse(req.body);
      await authService.forgotPassword(email);
      // Toujours répondre OK (ne pas révéler si l'email existe)
      res.json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token, password } = resetPasswordSchema.parse(req.body);
      await authService.resetPassword(token, password);
      res.json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  async resendInvitation(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const user = (req as AuthenticatedRequest).user;
      const { memberId } = req.params;
      await authService.resendInvitation(memberId, user.tenantId!);
      res.json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },

  async me(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const jwtUser = (req as AuthenticatedRequest).user;
      const user = await userRepository.findById(jwtUser.userId);
      if (!user) {
        res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Utilisateur introuvable' } });
        return;
      }
      res.json({
        success: true,
        data: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          tenantId: user.tenantId,
          fixedSalary: user.fixedSalary,
          objectives: Array.isArray((user as Record<string, unknown>).objectives)
            ? (user as Record<string, unknown>).objectives
            : [],
          isActive: user.isActive,
          emailVerified: user.emailVerified,
          createdAt: user.createdAt.toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },

  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { token } = z.object({ token: z.string().min(1) }).parse(req.body);
      await authService.verifyManagerEmail(token);
      res.json({ success: true, data: null });
    } catch (err) {
      next(err);
    }
  },
};


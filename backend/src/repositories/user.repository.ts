import { User, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';

export interface CreateUserData {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId?: string;
  groupId?: string;
  fixedSalary?: number;
  inviteToken?: string;
  inviteTokenExpiry?: Date;
}

export const userRepository = {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } });
  },

  async findByInviteToken(token: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { inviteToken: token } });
  },

  async findByResetToken(token: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { resetToken: token } });
  },

  async findByTenantId(tenantId: string): Promise<User[]> {
    return prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async create(data: CreateUserData): Promise<User> {
    return prisma.user.create({ data });
  },

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async update(id: string, data: Partial<User> | Record<string, unknown>): Promise<User> {
    return prisma.user.update({ where: { id }, data: data as any });
  },

  async updatePassword(id: string, passwordHash: string): Promise<User> {
    return prisma.user.update({ where: { id }, data: { passwordHash } });
  },

  async verifyEmail(id: string): Promise<User> {
    return prisma.user.update({
      where: { id },
      data: { emailVerified: true, inviteToken: null, inviteTokenExpiry: null },
    });
  },

  async findByIds(ids: string[], tenantId: string): Promise<User[]> {
    if (ids.length === 0) return [];
    return prisma.user.findMany({
      where: { id: { in: ids }, tenantId, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
  },

  async findByTenantIdAndRoles(tenantId: string, roles: UserRole[]): Promise<User[]> {
    return prisma.user.findMany({
      where: { tenantId, isActive: true, role: { in: roles } },
      orderBy: { createdAt: 'asc' },
    });
  },

  async countActiveByTenantId(tenantId: string): Promise<number> {
    return prisma.user.count({ where: { tenantId, isActive: true } });
  },

  async deactivate(id: string, tenantId: string): Promise<User> {
    return prisma.user.update({ where: { id, tenantId }, data: { isActive: false } });
  },

  async hardDelete(id: string, tenantId: string): Promise<void> {
    // Vérification d'appartenance au tenant avant suppression définitive
    const user = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!user) throw new Error('Utilisateur introuvable');
    await prisma.user.delete({ where: { id } });
  },
};

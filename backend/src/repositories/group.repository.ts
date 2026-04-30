import { prisma } from '../config/prisma';

const userSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  role: true,
  isActive: true,
  emailVerified: true,
  fixedSalary: true,
  objectives: true,
  createdAt: true,
  groupId: true,
} as const;

export const groupRepository = {
  async findByTenantId(tenantId: string) {
    return prisma.group.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        lead: { select: userSelect },
        members: {
          where: { isActive: true },
          select: userSelect,
          orderBy: { firstName: 'asc' },
        },
      },
    });
  },

  async create(tenantId: string, name: string, color: string, managerId?: string) {
    return prisma.group.create({
      data: { tenantId, name, color, ...(managerId ? { managerId } : {}) },
    });
  },

  async update(id: string, tenantId: string, data: { name?: string; color?: string }) {
    return prisma.group.update({
      where: { id, tenantId },
      data,
    });
  },

  async delete(id: string, tenantId: string) {
    await prisma.group.delete({ where: { id, tenantId } });
  },

  async assignMember(memberId: string, groupId: string | null, tenantId: string) {
    // Vérifier que le groupe cible appartient bien au même tenant
    if (groupId !== null) {
      const group = await prisma.group.findUnique({ where: { id: groupId } });
      if (!group || group.tenantId !== tenantId) {
        throw new Error('Groupe introuvable ou appartient à un autre tenant');
      }
    }
    return prisma.user.update({
      where: { id: memberId, tenantId },
      data: { groupId },
    });
  },

  async assignLead(groupId: string, leadId: string | null, tenantId: string) {
    return prisma.group.update({
      where: { id: groupId, tenantId },
      data: { leadId },
    });
  },

};

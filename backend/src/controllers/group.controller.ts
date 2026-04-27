import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { groupRepository } from '../repositories/group.repository';
import { AuthenticatedRequest } from '../middlewares/auth';
import { UserRole } from '../../../shared/types';
import { prisma } from '../config/prisma';

const createSchema = z.object({
  name: z.string().min(1, 'Nom requis').max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
});

const updateSchema = z.object({
  name: z.string().min(1).max(60).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const assignSchema = z.object({
  groupId: z.string().nullable(),
});

const assignLeadSchema = z.object({
  leadId: z.string().nullable(),
});

export const groupController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId, userId, role } = (req as AuthenticatedRequest).user;

      const include = {
        lead: { select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, emailVerified: true, fixedSalary: true, objectives: true, createdAt: true, groupId: true } },
        members: {
          where: { isActive: true },
          select: { id: true, firstName: true, lastName: true, email: true, role: true, isActive: true, emailVerified: true, fixedSalary: true, objectives: true, createdAt: true, groupId: true },
          orderBy: { firstName: 'asc' as const },
        },
      };

      let groups;
      if (role === UserRole.TEAM_LEAD) {
        groups = await prisma.group.findMany({
          where: { leadId: userId, tenantId: tenantId! },
          include,
          orderBy: { createdAt: 'asc' },
        });
      } else if (role === UserRole.MANAGER || role === UserRole.BU_MANAGER) {
        groups = await prisma.group.findMany({
          where: { managerId: userId, tenantId: tenantId! },
          include,
          orderBy: { createdAt: 'asc' },
        });
      } else {
        groups = await groupRepository.findByTenantId(tenantId!);
      }

      res.json({ success: true, data: groups });
    } catch (err) { next(err); }
  },

  async create(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const { name, color } = createSchema.parse(req.body);
      const group = await groupRepository.create(tenantId!, name, color);
      res.status(201).json({ success: true, data: group });
    } catch (err) { next(err); }
  },

  async update(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const { groupId } = req.params;
      const data = updateSchema.parse(req.body);
      const group = await groupRepository.update(groupId, tenantId!, data);
      res.json({ success: true, data: group });
    } catch (err) { next(err); }
  },

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const { groupId } = req.params;
      await groupRepository.delete(groupId, tenantId!);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async assignMember(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const { memberId } = req.params;
      const { groupId } = assignSchema.parse(req.body);
      await groupRepository.assignMember(memberId, groupId, tenantId!);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

  async assignLead(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { tenantId } = (req as AuthenticatedRequest).user;
      const { groupId } = req.params;
      const { leadId } = assignLeadSchema.parse(req.body);
      await groupRepository.assignLead(groupId, leadId, tenantId!);
      res.json({ success: true });
    } catch (err) { next(err); }
  },

};

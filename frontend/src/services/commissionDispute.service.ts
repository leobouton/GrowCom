import { api } from './api';
import type { CommissionDispute, DisputeStatus } from '@shared/types';

export const commissionDisputeService = {
  async raise(commissionId: string, reason: string): Promise<CommissionDispute> {
    const res = await api.post<{ success: true; data: CommissionDispute }>(
      `/disputes/commissions/${commissionId}/raise`,
      { reason },
    );
    return res.data.data;
  },

  async resolve(
    disputeId: string,
    action: 'accept' | 'reject',
    response: string,
    dealUpdates?: {
      title?: string;
      clientName?: string | null;
      amount?: number;
      dealType?: string | null;
      notes?: string | null;
      costAmount?: number | null;
      marginAmount?: number | null;
    },
    commissionOverride?: number | null,
  ): Promise<CommissionDispute> {
    const res = await api.post<{ success: true; data: CommissionDispute }>(
      `/disputes/${disputeId}/resolve`,
      {
        action,
        response,
        ...(dealUpdates ? { dealUpdates } : {}),
        ...(commissionOverride !== undefined && commissionOverride !== null ? { commissionOverride } : {}),
      },
    );
    return res.data.data;
  },

  async listByCommission(commissionId: string): Promise<CommissionDispute[]> {
    const res = await api.get<{ success: true; data: CommissionDispute[] }>(
      `/disputes/commissions/${commissionId}`,
    );
    return res.data.data;
  },

  async listByTenant(status?: DisputeStatus): Promise<CommissionDispute[]> {
    const url = status ? `/disputes?status=${status}` : '/disputes';
    const res = await api.get<{ success: true; data: CommissionDispute[] }>(url);
    return res.data.data;
  },
};

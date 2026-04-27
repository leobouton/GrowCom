import { api } from './api';
import type { CommissionWithDetails, ManagerDashboardStats, CommercialDashboardStats } from '@shared/types';

export const commissionApiService = {
  async getManagerStats(params?: {
    period: 'month' | 'year';
    year: number;
    month?: number;
  }): Promise<ManagerDashboardStats & {
    pendingCommissions: CommissionWithDetails[];
  }> {
    let url = '/commissions/manager/stats';
    if (params) {
      const qs = new URLSearchParams({
        period: params.period,
        year: params.year.toString(),
        ...(params.month !== undefined ? { month: params.month.toString() } : {}),
      });
      url += `?${qs.toString()}`;
    }
    const res = await api.get<{
      success: true;
      data: ManagerDashboardStats & { pendingCommissions: CommissionWithDetails[] };
    }>(url);
    return res.data.data;
  },

  async getCommercialStats(): Promise<
    CommercialDashboardStats & {
      projections: Array<{
        deal: { id: string; title: string; amount: number; probability: number };
        projectedCommission: number;
        explanation: string;
      }>;
      commissions: CommissionWithDetails[];
    }
  > {
    const res = await api.get('/commissions/commercial/stats');
    return (res.data as { success: true; data: unknown }).data as CommercialDashboardStats & {
      projections: Array<{
        deal: { id: string; title: string; amount: number; probability: number };
        projectedCommission: number;
        explanation: string;
      }>;
      commissions: CommissionWithDetails[];
    };
  },

  async getPending(): Promise<CommissionWithDetails[]> {
    const res = await api.get<{ success: true; data: CommissionWithDetails[] }>(
      '/commissions/manager/pending',
    );
    return res.data.data;
  },

  async validate(commissionId: string): Promise<CommissionWithDetails> {
    const res = await api.patch<{ success: true; data: CommissionWithDetails }>(
      `/commissions/${commissionId}/status`,
      { action: 'validate' },
    );
    return res.data.data;
  },

  async markAsPaid(commissionId: string): Promise<CommissionWithDetails> {
    const res = await api.patch<{ success: true; data: CommissionWithDetails }>(
      `/commissions/${commissionId}/status`,
      { action: 'pay' },
    );
    return res.data.data;
  },
};

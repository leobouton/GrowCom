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
      data: ManagerDashboardStats & {
        pendingCommissions: CommissionWithDetails[];
      };
    }>(url);
    return res.data.data;
  },

  async getCommercialStats(): Promise<
    CommercialDashboardStats & {
      projections: Array<{
        deal: { id: string; title: string; clientName: string | null; amount: number; probability: number };
        projectedCommission: number;
        explanation: string;
      }>;
      commissions: CommissionWithDetails[];
    }
  > {
    const res = await api.get('/commissions/commercial/stats');
    return (res.data as { success: true; data: unknown }).data as CommercialDashboardStats & {
      projections: Array<{
        deal: { id: string; title: string; clientName: string | null; amount: number; probability: number };
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

  async markClientPaid(commissionId: string): Promise<CommissionWithDetails> {
    const res = await api.post<{ success: true; data: CommissionWithDetails }>(
      `/commissions/${commissionId}/mark-client-paid`,
      {},
    );
    return res.data.data;
  },

  async cancel(
    commissionId: string,
    reason: string,
    cancelDeal?: boolean,
  ): Promise<{ commission: CommissionWithDetails; adjustment: unknown | null }> {
    const res = await api.post<{
      success: true;
      data: { commission: CommissionWithDetails; adjustment: unknown | null };
    }>(`/commissions/${commissionId}/cancel`, { reason, cancelDeal });
    return res.data.data;
  },

  /** Chantier 3 — Retourne les commissions PENDING pour la page Mes Projections */
  async getProjections(): Promise<ProjectionsData> {
    const res = await api.get<{ success: true; data: ProjectionsData }>('/commissions/projections');
    return res.data.data;
  },

  async revertToPending(
    commissionId: string,
    reason: string,
  ): Promise<{ commission: CommissionWithDetails; adjustment: unknown | null }> {
    const res = await api.post<{
      success: true;
      data: { commission: CommissionWithDetails; adjustment: unknown | null };
    }>(`/commissions/${commissionId}/revert`, { reason });
    return res.data.data;
  },

  async delete(commissionId: string): Promise<void> {
    await api.delete(`/commissions/${commissionId}`);
  },
};

/** Type de réponse pour l'endpoint /commissions/projections */
export interface ProjectionsData {
  totalAmount: number;
  count: number;
  byStatus: {
    awaitingClientPayment: { count: number; amount: number };
    standardPending: { count: number; amount: number };
  };
  commissions: ProjectionCommission[];
}

export interface ProjectionCommission {
  id: string;
  amount: number;
  dealTitle: string;
  clientName: string | null;
  dealAmount: number | null;
  dealClosedAt: string | null;
  awaitingClientPayment: boolean;
  scheduledPaymentAt: string | null;
  ruleName: string;
  calculationDetail: string;
}

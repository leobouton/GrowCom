import { api } from './api';
import type { PublicUser, LoginRequest, RegisterRequest } from '@shared/types';

interface AuthResponse {
  accessToken: string;
  user: PublicUser;
}

export const authApiService = {
  async register(data: RegisterRequest): Promise<AuthResponse> {
    const res = await api.post<{ success: true; data: AuthResponse }>('/auth/register', data);
    return res.data.data;
  },

  async login(data: LoginRequest): Promise<AuthResponse> {
    const res = await api.post<{ success: true; data: AuthResponse }>('/auth/login', data);
    return res.data.data;
  },

  async logout(): Promise<void> {
    await api.post('/auth/logout');
  },

  async me(): Promise<PublicUser> {
    const res = await api.get<{ success: true; data: PublicUser }>('/auth/me');
    return res.data.data;
  },

  async inviteCommercial(data: {
    email: string;
    firstName: string;
    lastName: string;
    role?: string;
    fixedSalary?: number;
  }): Promise<PublicUser> {
    const res = await api.post<{ success: true; data: PublicUser }>('/auth/invite', data);
    return res.data.data;
  },

  async resendInvitation(memberId: string): Promise<void> {
    await api.post(`/auth/team/${memberId}/resend-invitation`);
  },

  async forgotPassword(email: string): Promise<void> {
    await api.post('/auth/forgot-password', { email });
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await api.post('/auth/reset-password', { token, password });
  },

  async verifyEmail(token: string): Promise<void> {
    await api.post('/auth/verify-email', { token });
  },

  async acceptInvitation(token: string, password: string): Promise<AuthResponse> {
    const res = await api.post<{ success: true; data: AuthResponse }>('/auth/accept-invitation', {
      token,
      password,
    });
    return res.data.data;
  },
};

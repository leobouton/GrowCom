import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { authApiService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/auth.store';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useState } from 'react';

const schema = z
  .object({
    password: z.string().min(12, 'Minimum 12 caractères'),
    confirmPassword: z.string().min(1, 'Confirmez votre mot de passe'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Les mots de passe ne correspondent pas',
    path: ['confirmPassword'],
  });

type FormData = z.infer<typeof schema>;

export function InvitationPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const token = searchParams.get('token');

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-gray-900">Lien invalide</h1>
          <p className="text-gray-500 mt-2">Ce lien d'invitation est invalide ou a expiré.</p>
        </div>
      </div>
    );
  }

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      const result = await authApiService.acceptInvitation(token, data.password);
      setAuth(result.user, result.accessToken);
      navigate('/dashboard');
    } catch {
      setError("Ce lien d'invitation est invalide ou a expiré.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-600 rounded-xl mb-3">
            <span className="text-white font-bold text-xl">G</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Créer votre mot de passe</h1>
          <p className="text-gray-500 mt-1">Vous avez été invité(e) sur GrowCom</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-5">
            <Input
              label="Mot de passe"
              type="password"
              placeholder="Minimum 12 caractères"
              error={errors.password?.message}
              showPasswordToggle
              {...register('password')}
            />
            <Input
              label="Confirmer le mot de passe"
              type="password"
              placeholder="••••••••"
              error={errors.confirmPassword?.message}
              showPasswordToggle
              {...register('confirmPassword')}
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
              Créer mon compte et me connecter
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { authApiService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/auth.store';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { UserRole } from '@shared/types';
import { useState } from 'react';

const schema = z.object({
  email: z.string().email('Email invalide'),
  password: z.string().min(1, 'Mot de passe requis'),
});

type FormData = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      const result = await authApiService.login(data);
      setAuth(result.user, result.accessToken);

      switch (result.user.role) {
        case UserRole.SUPER_ADMIN:
          navigate('/admin');
          break;
        case UserRole.MANAGER:
        case UserRole.TEAM_LEAD:
        case UserRole.BU_MANAGER:
          navigate('/manager');
          break;
        case UserRole.COMMERCIAL:
        case UserRole.RECRUITER:
          navigate('/dashboard');
          break;
      }
    } catch {
      setError('Email ou mot de passe incorrect');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-600 rounded-xl mb-3">
            <span className="text-white font-bold text-xl">G</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Bienvenue sur GrowCom</h1>
          <p className="text-gray-500 mt-1">Connectez-vous à votre espace</p>
        </div>

        {/* Formulaire */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-5">
            <Input
              label="Adresse email"
              type="email"
              placeholder="vous@entreprise.fr"
              error={errors.email?.message}
              {...register('email')}
            />
            <div>
              <Input
                label="Mot de passe"
                type="password"
                placeholder="••••••••"
                error={errors.password?.message}
                showPasswordToggle
                {...register('password')}
              />
              <div className="text-right mt-1">
                <Link
                  to="/forgot-password"
                  className="text-xs text-primary-600 hover:text-primary-700 hover:underline"
                >
                  Mot de passe oublié ?
                </Link>
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
              Se connecter
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Pas encore de compte ?{' '}
              <Link to="/register" className="text-primary-600 font-medium hover:text-primary-700">
                Créer un espace entreprise
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

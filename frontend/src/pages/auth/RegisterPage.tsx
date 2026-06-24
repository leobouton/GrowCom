import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { authApiService } from '../../services/auth.service';
import { useAuthStore } from '../../stores/auth.store';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { useState } from 'react';

const schema = z.object({
  firstName: z.string().min(1, 'Prénom requis'),
  lastName: z.string().min(1, 'Nom requis'),
  email: z.string().email('Email invalide'),
  password: z.string().min(12, 'Minimum 12 caractères'),
  companyName: z.string().min(1, "Nom de l'entreprise requis"),
  companySlug: z
    .string()
    .min(2, 'Minimum 2 caractères')
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'Uniquement lettres minuscules, chiffres et tirets'),
});

type FormData = z.infer<typeof schema>;

export function RegisterPage() {
  const navigate = useNavigate();
  const { setAuth } = useAuthStore();
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  // Auto-générer le slug depuis le nom d'entreprise
  const handleCompanyNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    const slug = value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    setValue('companySlug', slug);
  };

  const onSubmit = async (data: FormData) => {
    setError(null);
    try {
      const result = await authApiService.register(data);
      setAuth(result.user, result.accessToken);
      navigate('/manager');
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Une erreur est survenue';
      setError(message);
    }
  };

  void watch;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 bg-primary-600 rounded-xl mb-3">
            <span className="text-white font-bold text-xl">G</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Créer votre espace GrowCom</h1>
          <p className="text-gray-500 mt-1">Pour les managers d'équipes commerciales</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Prénom"
                placeholder="Marie"
                error={errors.firstName?.message}
                {...register('firstName')}
              />
              <Input
                label="Nom"
                placeholder="Dupont"
                error={errors.lastName?.message}
                {...register('lastName')}
              />
            </div>

            <Input
              label="Email professionnel"
              type="email"
              placeholder="marie@entreprise.fr"
              error={errors.email?.message}
              {...register('email')}
            />

            <Input
              label="Mot de passe"
              type="password"
              placeholder="Minimum 12 caractères"
              error={errors.password?.message}
              showPasswordToggle
              {...register('password')}
            />

            <Input
              label="Nom de votre entreprise"
              placeholder="Mon Agence RH"
              error={errors.companyName?.message}
              {...register('companyName', {
                onChange: handleCompanyNameChange,
              })}
            />

            <Input
              label="Identifiant URL (slug)"
              placeholder="mon-agence-rh"
              hint="Uniquement lettres minuscules, chiffres et tirets"
              error={errors.companySlug?.message}
              {...register('companySlug')}
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            <Button type="submit" size="lg" loading={isSubmitting} className="w-full">
              Créer mon espace
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Déjà un compte ?{' '}
              <Link to="/login" className="text-primary-600 font-medium hover:text-primary-700">
                Se connecter
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

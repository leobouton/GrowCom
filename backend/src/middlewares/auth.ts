import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AppError } from './errorHandler';
import { UserRole } from '../../../shared/types';

export interface AuthenticatedRequest extends Request {
  user: {
    userId: string;
    email: string;
    role: UserRole;
    tenantId: string | null;
  };
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    next(new AppError(401, 'UNAUTHORIZED', 'Token d\'authentification manquant'));
    return;
  }

  const token = authHeader.substring(7);

  try {
    const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as {
      userId: string;
      email: string;
      role: UserRole;
      tenantId: string | null;
    };

    (req as AuthenticatedRequest).user = payload;
    next();
  } catch {
    next(new AppError(401, 'TOKEN_INVALID', 'Token invalide ou expiré'));
  }
}

export function checkRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = (req as AuthenticatedRequest).user;

    if (!user) {
      next(new AppError(401, 'UNAUTHORIZED', 'Non authentifié'));
      return;
    }

    if (!roles.includes(user.role)) {
      next(
        new AppError(403, 'FORBIDDEN', 'Vous n\'avez pas les droits nécessaires pour cette action'),
      );
      return;
    }

    next();
  };
}

export function checkTenant(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as AuthenticatedRequest).user;

  if (!user) {
    next(new AppError(401, 'UNAUTHORIZED', 'Non authentifié'));
    return;
  }

  if (user.role !== UserRole.SUPER_ADMIN && !user.tenantId) {
    next(new AppError(403, 'FORBIDDEN', 'Aucun tenant associé à ce compte'));
    return;
  }

  next();
}

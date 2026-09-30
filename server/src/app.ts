import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { errorHandler, notFound } from './lib/errors';
import { accountRouter } from './routes/account';
import { adminRouter } from './routes/admin';
import { partnerRouter } from './routes/partner';
import { paymentsRouter } from './routes/payments';
import { publicRouter } from './routes/public';

export function buildApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());
  // The web app is served same-origin (Vite proxy / nginx); CORS only for that origin.
  app.use(cors({ origin: config.WEB_PUBLIC_URL, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false }));

  const api = express.Router();
  api.use(publicRouter);
  api.use(accountRouter);
  api.use(paymentsRouter);
  api.use(adminRouter);
  api.use(partnerRouter);
  api.use(() => {
    throw notFound('No such endpoint');
  });
  app.use('/api', api);
  app.use(errorHandler);
  return app;
}

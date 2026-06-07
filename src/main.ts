import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import configuration from './config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    { rawBody: true }, // REQUIRED for webhook signature verification
  );

  const config = configuration();
  await app.listen(config.port, '0.0.0.0');
  console.log(`PRReviewer listening on port ${config.port}`);
}

void bootstrap();

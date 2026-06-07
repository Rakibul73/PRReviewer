import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { WebhookModule } from './webhook/webhook.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      // Never log config values in production — private key would be exposed
      expandVariables: false,
    }),
    WebhookModule,
  ],
})
export class AppModule {}

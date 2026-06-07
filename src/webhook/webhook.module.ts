import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { ReviewModule } from '../review/review.module';

@Module({
  imports: [ReviewModule],
  controllers: [WebhookController],
  providers: [WebhookService],
})
export class WebhookModule {}

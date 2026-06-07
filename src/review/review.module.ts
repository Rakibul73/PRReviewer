import { Module } from '@nestjs/common';
import { ReviewService } from './review.service';
import { GithubModule } from '../github/github.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [GithubModule, AiModule],
  providers: [ReviewService],
  exports: [ReviewService],
})
export class ReviewModule {}

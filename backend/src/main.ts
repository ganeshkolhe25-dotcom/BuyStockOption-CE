import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
// v1.0.0 - WebSocket tick feed, ATR buffer, RSI/volume filters, persistent halt, RDX filter

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}
bootstrap();

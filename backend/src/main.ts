import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { WebSocketServer } from 'ws';
import { PriceGatewayService } from './price-gateway.service';
// v1.0.0 - WebSocket tick feed, ATR buffer, RSI/volume filters, persistent halt, RDX filter

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors();
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');

  // Attach live-price WebSocket server to the same HTTP server on path /ws
  // Browser connects to ws(s)://host/ws and receives position price pushes every ~1s
  const httpServer = app.getHttpServer();
  const wss = new WebSocketServer({ noServer: true });
  const priceGateway = app.get(PriceGatewayService);

  httpServer.on('upgrade', (request: any, socket: any, head: any) => {
    if (request.url === '/ws') {
      wss.handleUpgrade(request, socket, head, (wsClient) => {
        priceGateway.registerClient(wsClient);
      });
    } else {
      socket.destroy();
    }
  });
}
bootstrap();

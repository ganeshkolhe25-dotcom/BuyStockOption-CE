import { Injectable, Logger } from '@nestjs/common';
import { WebSocket } from 'ws';

export interface PositionPriceUpdate {
    token: string;
    ltp: number;
    pnl: number;
}

@Injectable()
export class PriceGatewayService {
    private readonly logger = new Logger(PriceGatewayService.name);
    private readonly clients = new Set<WebSocket>();

    registerClient(ws: WebSocket): void {
        this.clients.add(ws);
        this.logger.log(`[WS] Browser client connected. Active: ${this.clients.size}`);
        ws.on('close', () => {
            this.clients.delete(ws);
            this.logger.log(`[WS] Browser client disconnected. Active: ${this.clients.size}`);
        });
        ws.on('error', () => this.clients.delete(ws));
    }

    hasClients(): boolean {
        return this.clients.size > 0;
    }

    emitPositionPrices(updates: PositionPriceUpdate[]): void {
        if (this.clients.size === 0 || updates.length === 0) return;
        const payload = JSON.stringify({ type: 'position_prices', data: updates });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }

    emitFirst5CandleEvent(event: { eventType: string; symbol: string; data: any }): void {
        if (this.clients.size === 0) return;
        const payload = JSON.stringify({ type: 'first5candle_event', ...event });
        for (const client of this.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
}

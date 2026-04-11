import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import axios from 'axios';
import { PaperTradingService } from './paper.service';
import { ScannerService } from './scanner.service';
import { PrismaService } from './prisma.service';
import { HeartbeatService } from './heartbeat.service';
import { ShoonyaService } from './shoonya.service';
import { GannAngleService } from './gann-angle.service';
import { NseService } from './nse.service';

@Controller()
export class AppController {
  constructor(
    private readonly paperTrading: PaperTradingService,
    private readonly scannerService: ScannerService,
    private readonly prisma: PrismaService,
    private readonly heartbeatService: HeartbeatService,
    private readonly shoonyaService: ShoonyaService,
    private readonly gannAngleService: GannAngleService,
    private readonly nseService: NseService
  ) { }

  @Get('portfolio')
  async getPortfolio() {
    return await this.paperTrading.getPortfolioSummary();
  }

  @Get('watchlist')
  async getWatchlist() {
    return await this.heartbeatService.getActiveWatchlist();
  }

  @Get('scan')
  async getLatestScanResults() {
    return await this.scannerService.getLatestScanResults();
  }

  @Get('history')
  async getTradeHistory() {
    return await this.prisma.tradeHistory.findMany({
      orderBy: { entryTime: 'desc' },
      take: 500
    });
  }

  @Post('square-off')
  async manualSquareOff(@Body() body: { token: string }) {
    if (!body || !body.token) return { status: 'error', message: 'Token required' };

    const summary = await this.paperTrading.getPortfolioSummary();
    const position = summary.positions.find(p => p.token === body.token);

    if (position) {
      await this.paperTrading.closePosition(body.token, position.currentLtp, 'Manual Square-Off');
      return { status: 'success', message: `Closed ${body.token} at ₹${position.currentLtp}` };
    }
    return { status: 'error', message: 'Position not found' };
  }

  @Get('shoonya-config')
  async getShoonyaConfig() {
    const config = await this.prisma.shoonyaConfig.findFirst();
    if (config) {
      const { pwd, webPwd, sessionToken, ...safeConfig } = config;
      return safeConfig;
    }

    return {
      uid: process.env.SHOONYA_UID || '',
      pwd: process.env.SHOONYA_PWD || '',
      factor2: process.env.SHOONYA_FACTOR2 || '',
      vc: process.env.SHOONYA_VC || '',
      appkey: process.env.SHOONYA_APPKEY || '',
      tradingMode: 'PAPER',
      maxTrades: 10,
      expiryMonth: 'APR',
      gann9Enabled: true,
      gannAngleEnabled: false,
      ema5Enabled: false
    };
  }

  @Post('shoonya-config')
  async saveShoonyaConfig(@Body() body: any) {
    let config = await this.prisma.shoonyaConfig.findFirst();
    if (config) {
      config = await this.prisma.shoonyaConfig.update({
        where: { id: config.id },
        data: {
          uid: body.uid,
          pwd: body.pwd,
          factor2: body.factor2,
          vc: body.vc,
          appkey: body.appkey,
          webPwd: body.webPwd || '',
          tradingMode: body.tradingMode || 'PAPER',
          maxTrades: parseInt(body.maxTrades) || 10,
          gann9MaxTrades: parseInt(body.gann9MaxTrades) || 5,
          gannAngleMaxTrades: parseInt(body.gannAngleMaxTrades) || 5,
          ema5MaxTrades: parseInt(body.ema5MaxTrades) || 5,
          gann9MaxLoss: parseFloat(body.gann9MaxLoss) || -10000,
          gannAngleMaxLoss: parseFloat(body.gannAngleMaxLoss) || -10000,
          ema5MaxLoss: parseFloat(body.ema5MaxLoss) || -10000,
          gann9MaxProfit: parseFloat(body.gann9MaxProfit) || 10000,
          gannAngleMaxProfit: parseFloat(body.gannAngleMaxProfit) || 10000,
          ema5MaxProfit: parseFloat(body.ema5MaxProfit) || 10000,
          expiryMonth: body.expiryMonth || 'APR',
          gann9Enabled: body.gann9Enabled !== undefined ? Boolean(body.gann9Enabled) : true,
          gannAngleEnabled: body.gannAngleEnabled !== undefined ? Boolean(body.gannAngleEnabled) : false,
          ema5Enabled: body.ema5Enabled !== undefined ? Boolean(body.ema5Enabled) : false
        }
      });
    } else {
      config = await this.prisma.shoonyaConfig.create({
        data: {
          uid: body.uid,
          pwd: body.pwd,
          factor2: body.factor2,
          vc: body.vc,
          appkey: body.appkey,
          webPwd: body.webPwd || '',
          tradingMode: body.tradingMode || 'PAPER',
          maxTrades: parseInt(body.maxTrades) || 10,
          gann9MaxTrades: parseInt(body.gann9MaxTrades) || 5,
          gannAngleMaxTrades: parseInt(body.gannAngleMaxTrades) || 5,
          ema5MaxTrades: parseInt(body.ema5MaxTrades) || 5,
          gann9MaxLoss: parseFloat(body.gann9MaxLoss) || -10000,
          gannAngleMaxLoss: parseFloat(body.gannAngleMaxLoss) || -10000,
          ema5MaxLoss: parseFloat(body.ema5MaxLoss) || -10000,
          gann9MaxProfit: parseFloat(body.gann9MaxProfit) || 10000,
          gannAngleMaxProfit: parseFloat(body.gannAngleMaxProfit) || 10000,
          ema5MaxProfit: parseFloat(body.ema5MaxProfit) || 10000,
          expiryMonth: body.expiryMonth || 'APR',
          gann9Enabled: body.gann9Enabled !== undefined ? Boolean(body.gann9Enabled) : true,
          gannAngleEnabled: body.gannAngleEnabled !== undefined ? Boolean(body.gannAngleEnabled) : false,
          ema5Enabled: body.ema5Enabled !== undefined ? Boolean(body.ema5Enabled) : false
        }
      });
    }
    return { status: 'success', data: config };
  }

  @Post('shoonya-test')
  async testShoonyaConnection() {
    const isSuccess = await this.shoonyaService.authenticate();
    if (isSuccess) {
      return { status: 'success', message: 'Connected to Shoonya API Successfully' };
    } else {
      return { status: 'error', message: this.shoonyaService.lastAuthError || 'Failed to authenticate with Shoonya API' };
    }
  }

  @Post('shoonya-exchange-code')
  async exchangeAuthCode(@Body() body: { authCode: string }) {
    if (!body?.authCode?.trim()) {
      return { status: 'error', message: 'authCode is required' };
    }
    const result = await this.shoonyaService.exchangeAuthCode(body.authCode.trim());
    return { status: result.success ? 'success' : 'error', message: result.message };
  }

  @Post('shoonya-auto-connect')
  async autoConnect() {
    const result = await this.shoonyaService.autoConnect();
    return { status: result.success ? 'success' : 'error', message: result.message, debug: (result as any).debug };
  }

  @Get()
  getHello(): string {
    return 'Gann-9 Trader API Running';
  }

  @Post('reset-capital')
  async resetCapital() {
    await this.paperTrading.resetAllPositionsForCapital();
    return { status: 'success', message: 'Capital reset. All ghost trades cleared.' };
  }

  @Post('force-entry')
  async forceEntry(@Body() body: { symbol: string, type: 'CE'|'PE', ltp: number, target: number, sl: number }) {
    const contract = await this.shoonyaService.findAtmOption(body.symbol, body.ltp, body.type);
    if (!contract) return { status: 'error', message: 'Could not resolve April Token' };

    const quote = await this.shoonyaService.getOptionQuote(contract.token);
    const entryPrice = quote?.askPrice || (body.type === 'CE' ? 50 : 50); // Fallback to estimated premium if quote fails

    await this.paperTrading.placeBuyOrder(
      body.symbol,
      contract.token,
      contract.tradingSymbol,
      body.type,
      contract.lotSize,
      entryPrice,
      body.target,
      body.sl
    );

    return { status: 'success', message: `Force entry recovery successful for ${body.symbol}` };
  }

  @Get('gann-angle/:symbol')
  async getGannAngle(@Param('symbol') symbol: string) {
    const cleanSymbol = symbol.replace('.NS', '');
    const quote = await this.nseService.getStockQuoteWithPrevClose(cleanSymbol);
    if (!quote) {
        return { status: 'error', message: 'Could not fetch quote from NSE' };
    }

    const levels = this.gannAngleService.calculateAngles(quote.prevClose);
    const signal = this.gannAngleService.generateSignal(quote.ltp, levels);

    return {
        status: 'success',
        symbol: cleanSymbol,
        ltp: quote.ltp,
        levels: levels,
        signal: signal
    };
  }
  @Get('debug-scrip/:symbol/:strike')
  async debugScrip(@Param('symbol') symbol: string, @Param('strike') strike: string) {
      return this.shoonyaService.debugSearchScrip(symbol, strike);
  }

  @Get('get-ip')
  async getOutboundIp() {
      try {
          const res = await axios.get('https://api4.ipify.org');
          return { status: 'success', ip: res.data.trim() };
      } catch (err) {
          return { status: 'error', message: 'Could not resolve outbound IP' };
      }
  }
  @Get('health')
  async healthCheck() {
      return { status: 'healthy', timestamp: new Date().toISOString(), message: 'Gann-9 Trader Engine is Running' };
  }

  @Get('status')
  async getBotStatus() {
    const portfolio = await this.paperTrading.getPositions();
    const stats = this.heartbeatService.getEngineStats();
    return {
        status: 'online',
        uptime: process.uptime(),
        activePositions: portfolio.length,
        dailyTrades: stats.tradesCount,
        lastHeartbeat: stats.lastHeartbeat
    };
  }
}



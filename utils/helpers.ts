import { Trade, ActiveTrade, ClosedTrade, TradeDirection } from '../types';

export const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(value);
};

export const formatPercent = (value: number) => {
    return `${value.toFixed(2)}%`;
};

export const calculatePL = (entryPrice: number, currentPrice: number, shareCount: number, direction: TradeDirection) => {
    if (direction === TradeDirection.Long) {
        return (currentPrice - entryPrice) * shareCount;
    } else {
        return (entryPrice - currentPrice) * shareCount;
    }
};

export const calculatePLPercent = (entryPrice: number, currentPrice: number, direction: TradeDirection) => {
    if (entryPrice === 0) return 0;
    if (direction === TradeDirection.Long) {
        return ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
        return ((entryPrice - currentPrice) / entryPrice) * 100;
    }
};

export const getDaysHeld = (entryDate: string) => {
    const start = new Date(entryDate).getTime();
    const end = new Date().getTime();
    const diff = end - start;
    return Math.floor(diff / (1000 * 60 * 60 * 24));
};

export const isTradeActive = (trade: Trade): trade is ActiveTrade => trade.status === 'active';
export const isTradeClosed = (trade: Trade): trade is ClosedTrade => trade.status === 'closed';

export const getChecklistScore = (checklist: { [key: string]: boolean }): number => {
    return Object.values(checklist).filter(Boolean).length;
};
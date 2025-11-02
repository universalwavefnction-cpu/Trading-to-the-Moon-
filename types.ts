
export enum TradeDirection {
    Long = 'Long',
    Short = 'Short',
}

export enum TradeSource {
    SelfDiscovered = 'Self-Discovered (technical + fundamental)',
    YouTube = 'YouTube',
    TwitterX = 'Twitter/X',
    UnusualOptions = 'Unusual Options Activity',
    AnalystReport = 'Analyst Upgrade/Report',
    EarningsCatalyst = 'Earnings Catalyst',
    AISuggestion = 'AI Suggestion',
    Other = 'Other',
}

export enum EmotionalState {
    Calm = 'Calm and analytical',
    Excited = 'Excited but controlled',
    FOMO = 'FOMO/Anxious',
    Revenge = 'Revenge trading',
}

export enum ExitReason {
    ProfitTarget = 'Hit profit target',
    StopLoss = 'Stop loss triggered',
    ThesisChanged = 'Thesis changed',
    BetterOpportunity = 'Better opportunity',
    Rebalancing = 'Portfolio rebalancing',
    Other = 'Other',
}

export interface CriteriaChecklist {
    catalyst45Days: boolean;
    analystsCovering: boolean;
    institutionalOwnership: boolean;
    technicalSetup: boolean;
    explainable: boolean;
}

export enum TradeAccount {
    IncomeGenerator = 'Income Generator',
    Speculation = 'Speculation',
    TradingLab = 'Trading Lab',
    Uncategorized = 'Uncategorized',
}

export interface FrameworkData {
    [key: string]: any;
}

export interface TradeEntryData {
    id: string;
    entryDate: string;
    ticker: string;
    entryPrice: number;
    positionSize: number;
    shareCount: number;
    direction: TradeDirection;
    source: TradeSource;
    sourceDetail: string;
    conviction: number;
    thesis: [string, string, string] | string;
    catalystDescription: string;
    catalystDate: string;
    bullCase: { price: number; probability: number };
    bearCase: { price: number; probability: number };
    stopLoss: number;
    takeProfit: { p25: number; p50: number; p100: number };
    portfolioValueOnEntry: number;
    maxRiskPercent: number;
    emotionalState: EmotionalState;
    checklist: CriteriaChecklist;
    // New optional fields for AI journaling
    account?: TradeAccount;
    rawUserInput?: string;
    frameworkData?: FrameworkData;
}

export interface TradeExitData {
    exitDate: string;
    exitPrice: number;
    exitReason: ExitReason;
    exitReasonDetail: string;
    reviewRight: string;
    reviewWrong: string;
    lessonLearned: string;
    wouldTakeAgain: { decision: 'Yes' | 'No'; reason: string };
    selfRating: number; // 1-5 stars
}

export interface ActiveTrade extends TradeEntryData {
    status: 'active';
    currentPrice?: number;
}

export interface ClosedTrade extends TradeEntryData {
    status: 'closed';
    exitData: TradeExitData;
}

export type Trade = ActiveTrade | ClosedTrade;

export interface AccountState {
    name: TradeAccount;
    startingValue: number;
    currentCash: number;
}

export interface Settings {
    portfolioStartingValue: number;
    riskPerTrade: number; // as percentage
    maxPositionSize: number; // as percentage
    minCashPercent: number; // as percentage
    tradingTimezone: string;
    accounts: AccountState[];
}

export interface WatchlistItem {
    id: string;
    ticker: string;
    currentPrice: number;
    reason: string;
    catalystDate: string;
    alertPrice: number;
    notes: string;
    dateAdded: string;
    status: 'Watching' | 'Entered' | 'Passed';
}

export interface CircuitBreakerInfo {
    peakPortfolioValue: number;
    isActive: boolean;
    resumesAt: string | null;
    reviewCompleted: boolean;
}
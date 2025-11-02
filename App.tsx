

import React, { useState, useMemo, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, Sector } from 'recharts';
import useLocalStorage from './hooks/useLocalStorage';
import { Trade, ActiveTrade, ClosedTrade, Settings, WatchlistItem, CircuitBreakerInfo, TradeSource, EmotionalState, TradeDirection, CriteriaChecklist, ExitReason, TradeAccount, AccountState } from './types';
import { formatCurrency, formatPercent, calculatePL, calculatePLPercent, getDaysHeld, isTradeActive, isTradeClosed, getChecklistScore } from './utils/helpers';
import { PlusIcon, DashboardIcon, HistoryIcon, AnalyticsIcon, SourceIcon, DisciplineIcon, WatchlistIcon, SettingsIcon, CloseIcon, LogoIcon } from './components/Icons';
import { GoogleGenAI, Type } from "@google/genai";


const SYSTEM_PROMPT = `
You are a trading journal assistant that categorizes every trade into one of three accounts and maps it to a structured framework. For every trade entry, you will:

1. Identify which account (Income Generator, Speculation, or Trading Lab)
2. Map it to the framework focus areas
3. Validate against account-specific rules
4. Document with required fields
5. Track performance metrics by category

═══════════════════════════════════════════════
ACCOUNT DEFINITIONS:
═══════════════════════════════════════════════

ACCOUNT 1: INCOME GENERATOR (€17,000)
Purpose: Generate €1,500-2,000/month income by March 2026
Strategy: Covered calls + Cash-secured puts + Growth stock appreciation
Holdings: 3-4 positions, 100+ shares each
Horizon: 12 months
Trade Types:
  - BUY_SHARES: Purchasing 100+ shares for covered calls
  - SELL_CC: Selling covered calls (weekly/monthly)
  - SELL_CSP: Selling cash-secured puts
  - ROLL: Rolling calls/puts up/out
  - ASSIGNMENT: Getting assigned on puts or having shares called away

ACCOUNT 2: SPECULATION (€3,000)
Purpose: High-leverage catalyst plays
Strategy: Buying call options on near-term catalysts
Holdings: 1-3 positions max, €200-300 each
Horizon: 30-60 days per trade
Trade Types:
  - BUY_CALLS: Purchasing call options
  - SELL_CALLS: Closing call positions
  - ROLL_CALLS: Rolling calls to different strike/date

ACCOUNT 3: TRADING LAB (€2,000)
Purpose: Learn swing/day trading, skill development
Strategy: Small position technical trades
Holdings: 1-2 positions, €75-150 each
Horizon: 1-10 days per trade
Trade Types:
  - BUY_SHARES: Opening swing position
  - SELL_SHARES: Closing swing position
  - STOP_LOSS: Stopped out of position

═══════════════════════════════════════════════
TRADE ENTRY TEMPLATE (Respond with this JSON structure):
═══════════════════════════════════════════════
Based on the user input, populate the following fields. The final output MUST be a single JSON object.

{
  "account": "[Income Generator / Speculation / Trading Lab]",
  "tradeType": "[BUY_SHARES / SELL_CC / SELL_CSP / BUY_CALLS / etc.]",
  "ticker": "_____",
  "action": "[OPEN / CLOSE / ROLL]",
  "direction": "[Long / Short]",
  "quantity": ___,
  "entryPrice": _____,
  "positionSize": _____ (in Euro),
  "thesis": "_____________________________",
  "stopLoss": _____ (price),
  "emotionalState": "[Calm and analytical / Excited but controlled / FOMO/Anxious / Revenge trading]",
  "validationFlags": ["Flag 1", "Flag 2"]
}

═══════════════════════════════════════════════
ACCOUNT-SPECIFIC VALIDATION:
═══════════════════════════════════════════════

ACCOUNT 1 RULES (Income Generator):
✓ Position size >€5,000 (or 100+ shares if stock <€50)
✓ Stock has weekly options available
✓ IV Rank >40%
✓ If SELL_CC: Strike 5-15% OTM, 7-14 DTE, premium >1% of stock price
✓ If SELL_CSP: Strike at price you'd buy, 30-45 DTE, premium >2%
✓ Total deployed: <85% of account (keep 15% cash buffer)
⚠️ FLAG if any rule broken in validationFlags array

ACCOUNT 2 RULES (Speculation):
✓ Position size €200-€300 max
✓ Total positions: <3 simultaneous  
✓ Total exposure: <30% of account (€900 max)
✓ If BUY_CALLS: 30-60 DTE, delta 0.40-0.70, catalyst within 45 days
✓ Stop loss at -50% of premium paid
⚠️ FLAG if any rule broken in validationFlags array

ACCOUNT 3 RULES (Trading Lab):
✓ Position size <€150
✓ Stop loss set immediately (-5% max)
✓ Trading 10am-3pm ET only
✓ Max 3 trades per week
✓ Trade logged BEFORE entry (not after)
⚠️ FLAG if any rule broken in validationFlags array

═══════════════════════════════════════════════
END OF CATEGORIZATION PROMPT
═══════════════════════════════════════════════
`;

const responseSchema = {
    type: Type.OBJECT,
    properties: {
        account: { type: Type.STRING, enum: ['Income Generator', 'Speculation', 'Trading Lab'] },
        tradeType: { type: Type.STRING },
        ticker: { type: Type.STRING },
        action: { type: Type.STRING, enum: ['OPEN', 'CLOSE', 'ROLL'] },
        direction: { type: Type.STRING, enum: ['Long', 'Short'] },
        quantity: { type: Type.NUMBER },
        entryPrice: { type: Type.NUMBER },
        positionSize: { type: Type.NUMBER },
        thesis: { type: Type.STRING },
        stopLoss: { type: Type.NUMBER },
        emotionalState: { type: Type.STRING, enum: Object.values(EmotionalState) },
        validationFlags: { type: Type.ARRAY, items: { type: Type.STRING } }
    },
    required: ['account', 'ticker', 'action', 'direction', 'quantity', 'entryPrice', 'positionSize', 'thesis']
};


// --- MAIN APP COMPONENT ---
const App: React.FC = () => {
    // --- STATE MANAGEMENT ---
    const [activeView, setActiveView] = useState('dashboard');
    const [trades, setTrades] = useLocalStorage<Trade[]>('trades', []);
    const [settings, setSettings] = useLocalStorage<Settings>('settings', {
        portfolioStartingValue: 22000,
        riskPerTrade: 2,
        maxPositionSize: 30,
        minCashPercent: 5,
        tradingTimezone: 'UTC',
        accounts: [
            { name: TradeAccount.IncomeGenerator, startingValue: 17000, currentCash: 17000 },
            { name: TradeAccount.Speculation, startingValue: 3000, currentCash: 3000 },
            { name: TradeAccount.TradingLab, startingValue: 2000, currentCash: 2000 },
        ]
    });
    const [watchlist, setWatchlist] = useLocalStorage<WatchlistItem[]>('watchlist', []);
    const [circuitBreaker, setCircuitBreaker] = useLocalStorage<CircuitBreakerInfo>('circuitBreaker', {
        peakPortfolioValue: settings.portfolioStartingValue,
        isActive: false,
        resumesAt: null,
        reviewCompleted: false,
    });
    const [isJournalEntryOpen, setJournalEntryOpen] = useState(false);
    
    const activeTrades = useMemo(() => trades.filter(isTradeActive), [trades]);
    const closedTrades = useMemo(() => trades.filter(isTradeClosed), [trades]);

    // --- NAVIGATION ---
    const navItems = [
        { id: 'dashboard', label: 'Dashboard', icon: <DashboardIcon /> },
        { id: 'history', label: 'Trade History', icon: <HistoryIcon /> },
        { id: 'analytics', label: 'Analytics', icon: <AnalyticsIcon /> },
    ];

    const renderView = () => {
        switch (activeView) {
            case 'dashboard':
                return <DashboardView activeTrades={activeTrades} settings={settings} setTrades={setTrades} setSettings={setSettings} />;
            case 'history':
                return <HistoryView closedTrades={closedTrades} />;
            case 'analytics':
                return <AnalyticsView closedTrades={closedTrades} />;
            default:
                return <DashboardView activeTrades={activeTrades} settings={settings} setTrades={setTrades} setSettings={setSettings} />;
        }
    };

    // --- TRADE ACTIONS ---
    const handleAddTrade = (newTrade: ActiveTrade) => {
        setTrades(prev => [...prev, newTrade]);
        
        setSettings(prev => {
            const newAccounts = prev.accounts.map(acc => {
                if (acc.name === newTrade.account) {
                    return { ...acc, currentCash: acc.currentCash - newTrade.positionSize };
                }
                return acc;
            });
            return { ...prev, accounts: newAccounts };
        });

        setJournalEntryOpen(false);
    };

    // --- UI ---
    return (
        <div className="flex h-screen bg-primary text-gray-200 font-sans">
            {/* Sidebar Navigation */}
            <aside className="w-16 md:w-64 bg-secondary flex flex-col">
                 <div className="flex items-center justify-center md:justify-start p-4 h-16 border-b border-border-color">
                    <LogoIcon />
                    <h1 className="hidden md:block ml-3 text-xl font-bold">UWF Trading</h1>
                </div>
                <nav className="flex-grow p-2">
                    {navItems.map(item => (
                        <button
                            key={item.id}
                            onClick={() => setActiveView(item.id)}
                            className={`flex items-center w-full p-3 my-1 rounded-lg transition-colors ${activeView === item.id ? 'bg-accent text-white' : 'hover:bg-gray-700'}`}
                        >
                            {item.icon}
                            <span className="hidden md:inline ml-4">{item.label}</span>
                        </button>
                    ))}
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col overflow-hidden">
                <header className="flex items-center justify-between p-4 h-16 bg-secondary border-b border-border-color">
                    <h2 className="text-2xl font-semibold capitalize">{activeView}</h2>
                    <button 
                        onClick={() => setJournalEntryOpen(true)}
                        className="flex items-center bg-success hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                    >
                        <PlusIcon />
                        <span className="hidden sm:inline ml-2">New Journal Entry</span>
                    </button>
                </header>
                <div className="flex-1 overflow-y-auto p-4 md:p-6 bg-primary">
                    {renderView()}
                </div>
            </main>

            {isJournalEntryOpen && (
                <AIJournalEntryModal
                    onClose={() => setJournalEntryOpen(false)} 
                    onAddTrade={handleAddTrade}
                    trades={trades}
                    settings={settings}
                    activeTrades={activeTrades}
                />
            )}
        </div>
    );
};

// --- VIEWS ---
interface DashboardViewProps {
    activeTrades: ActiveTrade[];
    settings: Settings;
    setTrades: React.Dispatch<React.SetStateAction<Trade[]>>;
    setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

const DashboardView: React.FC<DashboardViewProps> = ({ activeTrades, settings, setTrades, setSettings }) => {
    const [tradeToClose, setTradeToClose] = useState<ActiveTrade | null>(null);

    const handleCloseTrade = (closedTradeData: ClosedTrade) => {
        setTrades(prev => prev.map(t => t.id === closedTradeData.id ? closedTradeData : t));
        const pl = calculatePL(closedTradeData.entryPrice, closedTradeData.exitData.exitPrice, closedTradeData.shareCount, closedTradeData.direction);
        
        setSettings(prev => {
             const newAccounts = prev.accounts.map(acc => {
                if (acc.name === closedTradeData.account) {
                    return { ...acc, currentCash: acc.currentCash + closedTradeData.positionSize + pl };
                }
                return acc;
            });
            return { ...prev, accounts: newAccounts };
        });

        setTradeToClose(null);
    };

    return (
        <div className="space-y-8">
            {settings.accounts.map(account => {
                const accountTrades = activeTrades.filter(t => t.account === account.name);
                return (
                    <AccountDashboard
                        key={account.name}
                        account={account}
                        trades={accountTrades}
                        onOpenCloseModal={setTradeToClose}
                    />
                );
            })}
            
            {tradeToClose && (
                <TradeExitForm
                    trade={tradeToClose}
                    onClose={() => setTradeToClose(null)}
                    onConfirmClose={handleCloseTrade}
                />
            )}
        </div>
    );
};

interface AccountDashboardProps {
    account: AccountState;
    trades: ActiveTrade[];
    onOpenCloseModal: (trade: ActiveTrade) => void;
}

const AccountDashboard: React.FC<AccountDashboardProps> = ({ account, trades, onOpenCloseModal }) => {
    const { totalValue, totalPL } = useMemo(() => {
        let openPL = 0;
        const positionsValue = trades.reduce((acc, trade) => {
            const pl = calculatePL(trade.entryPrice, trade.currentPrice || trade.entryPrice, trade.shareCount, trade.direction);
            openPL += pl;
            return acc + trade.positionSize + pl;
        }, 0);
        return { totalValue: account.currentCash + positionsValue, totalPL: openPL };
    }, [trades, account.currentCash]);

    const accountColorClasses = {
        [TradeAccount.IncomeGenerator]: 'border-blue-500/50',
        [TradeAccount.Speculation]: 'border-yellow-500/50',
        [TradeAccount.TradingLab]: 'border-purple-500/50',
        [TradeAccount.Uncategorized]: 'border-gray-500/50',
    };

    return (
        <section>
            <div className={`p-4 bg-secondary rounded-lg border-l-4 ${accountColorClasses[account.name]}`}>
                <h3 className="text-xl font-semibold mb-4">{account.name}</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                    <SummaryCard title="Account Value" value={formatCurrency(totalValue)} />
                    <SummaryCard title="Cash" value={formatCurrency(account.currentCash)} />
                    <SummaryCard title="Open Positions" value={trades.length.toString()} />
                    <SummaryCard title="P/L (Open)" value={formatCurrency(totalPL)} isPL={true} />
                </div>
                {trades.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {trades.map(trade => (
                            <PositionCard key={trade.id} trade={trade} onOpenCloseModal={onOpenCloseModal} />
                        ))}
                    </div>
                ) : (
                    <div className="text-center py-6">
                        <p className="text-gray-400">No active positions in this account.</p>
                    </div>
                )}
            </div>
        </section>
    );
}

const HistoryView: React.FC<{ closedTrades: ClosedTrade[] }> = ({ closedTrades }) => {
    return (
        <div className="bg-secondary rounded-lg shadow p-4">
            <h3 className="text-xl font-semibold mb-4">Trade History</h3>
            <div className="overflow-x-auto">
                <table className="w-full text-left">
                    <thead>
                        <tr className="border-b border-border-color">
                            <th className="p-3">Ticker</th>
                            <th className="p-3">Account</th>
                            <th className="p-3">Entry Date</th>
                            <th className="p-3">Exit Date</th>
                            <th className="p-3">Direction</th>
                            <th className="p-3">P/L (€)</th>
                            <th className="p-3">P/L (%)</th>
                            <th className="p-3">Source</th>
                        </tr>
                    </thead>
                    <tbody>
                        {closedTrades.slice().reverse().map(trade => {
                            const pl = calculatePL(trade.entryPrice, trade.exitData.exitPrice, trade.shareCount, trade.direction);
                            const plPercent = calculatePLPercent(trade.entryPrice, trade.exitData.exitPrice, trade.direction);
                            const plColor = pl >= 0 ? 'text-success' : 'text-danger';
                            return (
                                <tr key={trade.id} className="border-b border-border-color hover:bg-primary">
                                    <td className="p-3 font-mono font-bold">{trade.ticker}</td>
                                    <td className="p-3 text-xs">{trade.account || 'N/A'}</td>
                                    <td className="p-3">{new Date(trade.entryDate).toLocaleDateString()}</td>
                                    <td className="p-3">{new Date(trade.exitData.exitDate).toLocaleDateString()}</td>
                                    <td className="p-3">{trade.direction}</td>
                                    <td className={`p-3 font-semibold ${plColor}`}>{formatCurrency(pl)}</td>
                                    <td className={`p-3 font-semibold ${plColor}`}>{formatPercent(plPercent)}</td>
                                    <td className="p-3">{trade.source}</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
                 {closedTrades.length === 0 && <p className="text-center py-6 text-gray-500">No closed trades yet.</p>}
            </div>
        </div>
    );
}

const AnalyticsView: React.FC<{ closedTrades: ClosedTrade[] }> = ({ closedTrades }) => {
    const accountData = useMemo(() => {
        const data = {
            [TradeAccount.IncomeGenerator]: [] as ClosedTrade[],
            [TradeAccount.Speculation]: [] as ClosedTrade[],
            [TradeAccount.TradingLab]: [] as ClosedTrade[],
            [TradeAccount.Uncategorized]: [] as ClosedTrade[],
        };
        closedTrades.forEach(trade => {
            data[trade.account || TradeAccount.Uncategorized].push(trade);
        });
        return data;
    }, [closedTrades]);

    const sourceData = useMemo(() => {
        const data: { [key: string]: ClosedTrade[] } = {};
        closedTrades.forEach(trade => {
            if (!data[trade.source]) data[trade.source] = [];
            data[trade.source].push(trade);
        });
        return Object.entries(data).map(([name, trades]) => {
            const wins = trades.filter(t => calculatePL(t.entryPrice, t.exitData.exitPrice, t.shareCount, t.direction) > 0).length;
            return {
                name,
                trades: trades.length,
                winRate: trades.length > 0 ? (wins / trades.length) * 100 : 0,
            };
        });
    }, [closedTrades]);

    return (
        <div className="space-y-8">
            <div>
                <h3 className="text-xl font-semibold mb-4">Performance by Account</h3>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {Object.values(TradeAccount).filter(a => a !== TradeAccount.Uncategorized).map(account => (
                        <AccountPerformanceCard key={account} account={account} trades={accountData[account]} />
                    ))}
                </div>
            </div>
            <div>
                 <h3 className="text-xl font-semibold mb-4">Performance by Source</h3>
                 <div className="bg-secondary p-4 rounded-lg">
                    <ResponsiveContainer width="100%" height={300}>
                        <BarChart data={sourceData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#30363D" />
                            <XAxis dataKey="name" stroke="#888" />
                            <YAxis yAxisId="left" orientation="left" stroke="#888" label={{ value: 'Win Rate (%)', angle: -90, position: 'insideLeft', fill: '#888' }} />
                             <YAxis yAxisId="right" orientation="right" dataKey="trades" stroke="#888" label={{ value: '# Trades', angle: 90, position: 'insideRight', fill: '#888' }} />
                            <Tooltip contentStyle={{ backgroundColor: '#161B22', border: '1px solid #30363D' }} />
                            <Legend />
                            <Bar yAxisId="left" dataKey="winRate" name="Win Rate" fill="#A78BFA" />
                            <Bar yAxisId="right" dataKey="trades" name="Num Trades" fill="#4c515c" />
                        </BarChart>
                    </ResponsiveContainer>
                 </div>
            </div>
        </div>
    );
};

const AccountPerformanceCard: React.FC<{account: TradeAccount, trades: ClosedTrade[]}> = ({account, trades}) => {
    const stats = useMemo(() => {
        const totalTrades = trades.length;
        if (totalTrades === 0) return { totalTrades: 0, winRate: 0, totalPL: 0, avgPL: 0 };

        let totalPL = 0;
        let wins = 0;
        trades.forEach(t => {
            const pl = calculatePL(t.entryPrice, t.exitData.exitPrice, t.shareCount, t.direction);
            if (pl > 0) wins++;
            totalPL += pl;
        });
        
        return {
            totalTrades,
            winRate: (wins / totalTrades) * 100,
            totalPL,
            avgPL: totalPL / totalTrades,
        };
    }, [trades]);

    const plColor = stats.totalPL >= 0 ? 'text-success' : 'text-danger';

    return (
        <div className="bg-secondary p-4 rounded-lg shadow">
            <h4 className="font-bold text-lg text-accent">{account}</h4>
            <div className="mt-4 space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-gray-400">Total P/L</span> <span className={`font-semibold ${plColor}`}>{formatCurrency(stats.totalPL)}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Win Rate</span> <span>{stats.winRate.toFixed(1)}%</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Closed Trades</span> <span>{stats.totalTrades}</span></div>
                <div className="flex justify-between"><span className="text-gray-400">Avg. P/L per Trade</span> <span className={stats.avgPL >= 0 ? 'text-success' : 'text-danger'}>{formatCurrency(stats.avgPL)}</span></div>
            </div>
        </div>
    );
}

// --- MODAL & FORM COMPONENTS ---

interface AIJournalEntryModalProps {
    onClose: () => void;
    onAddTrade: (trade: ActiveTrade) => void;
    trades: Trade[];
    settings: Settings;
    activeTrades: ActiveTrade[];
}

const AIJournalEntryModal: React.FC<AIJournalEntryModalProps> = ({ onClose, onAddTrade, trades, settings, activeTrades }) => {
    const [userInput, setUserInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [parsedTrade, setParsedTrade] = useState<any | null>(null);

    const processTradeWithAI = async (input: string) => {
        if (!process.env.API_KEY) {
            throw new Error("API_KEY environment variable not set.");
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-pro',
            contents: input,
            config: {
                systemInstruction: SYSTEM_PROMPT,
                responseMimeType: "application/json",
                responseSchema: responseSchema,
            },
        });
        
        try {
            return JSON.parse(response.text);
        } catch (e) {
            console.error("Failed to parse AI response:", e, "Raw response:", response.text);
            throw new Error("AI response was not valid JSON.");
        }
    };

    const handleProcess = async () => {
        if (!userInput.trim()) return;
        setIsLoading(true);
        setError('');
        setParsedTrade(null);
        try {
            const result = await processTradeWithAI(userInput);
            setParsedTrade(result);
        } catch (err: any) {
            setError(err.message || 'An error occurred while processing with AI.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleConfirm = () => {
        const entryPrice = parseFloat(parsedTrade.entryPrice) || 0;
        const positionSize = parseFloat(parsedTrade.positionSize) || 0;
        const assignedAccount = parsedTrade.account as TradeAccount || TradeAccount.Uncategorized;
        
        const currentPortfolioValue = settings.accounts.reduce((sum, acc) => sum + acc.currentCash, 0) + activeTrades.reduce((sum, t) => sum + t.positionSize, 0);

        const newTrade: ActiveTrade = {
            id: `TRADE-${(trades.length + 1).toString().padStart(3, '0')}`,
            status: 'active',
            entryDate: new Date().toISOString(),
            ticker: parsedTrade.ticker?.toUpperCase() || 'N/A',
            entryPrice,
            positionSize,
            shareCount: entryPrice > 0 ? positionSize / entryPrice : parsedTrade.quantity,
            direction: parsedTrade.direction as TradeDirection,
            source: TradeSource.AISuggestion,
            sourceDetail: 'AI Journal Entry',
            conviction: 5,
            thesis: parsedTrade.thesis || '',
            catalystDescription: '',
            catalystDate: '',
            bullCase: { price: 0, probability: 50 },
            bearCase: { price: 0, probability: 50 },
            stopLoss: parseFloat(parsedTrade.stopLoss) || 0,
            takeProfit: { p25: 0, p50: 0, p100: 0 },
            portfolioValueOnEntry: currentPortfolioValue,
            maxRiskPercent: settings.riskPerTrade,
            emotionalState: parsedTrade.emotionalState as EmotionalState || EmotionalState.Calm,
            checklist: { catalyst45Days: false, analystsCovering: false, institutionalOwnership: false, technicalSetup: false, explainable: false },
            account: assignedAccount,
            rawUserInput: userInput,
            frameworkData: parsedTrade,
        };
        onAddTrade(newTrade);
    };

    return (
        <Modal title="New AI Journal Entry" onClose={onClose}>
            {!parsedTrade ? (
                <div>
                    <p className="mb-2 text-gray-400">Describe your trade below. You can use free-form text or shortcuts like <code>/sell-cc PLTR 65 14 120</code>.</p>
                    <textarea 
                        value={userInput}
                        onChange={e => setUserInput(e.target.value)}
                        className="w-full p-2 bg-primary border border-border-color rounded-lg h-40 focus:outline-none focus:ring-2 focus:ring-accent"
                        placeholder="e.g., Buying 100 shares of TSM at $150. Thesis is AI chip demand. Stop loss at $140."
                    />
                    {error && <p className="text-danger mt-2 text-sm">{error}</p>}
                    <div className="flex justify-end mt-4">
                        <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg mr-2">Cancel</button>
                        <button onClick={handleProcess} disabled={isLoading || !userInput.trim()} className="bg-accent hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg disabled:bg-gray-500">
                            {isLoading ? 'Processing...' : 'Process with AI'}
                        </button>
                    </div>
                </div>
            ) : (
                <div>
                    <h3 className="text-lg font-semibold mb-2">Confirm Trade Details</h3>
                    <div className="bg-primary p-4 rounded-lg space-y-2 text-sm">
                        {Object.entries(parsedTrade).map(([key, value]) => (
                            <div key={key} className="flex justify-between">
                                <span className="text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1')}:</span>
                                <span className="font-mono">{Array.isArray(value) ? value.join(', ') : String(value)}</span>
                            </div>
                        ))}
                    </div>
                    {parsedTrade.validationFlags && parsedTrade.validationFlags.length > 0 && (
                        <div className="mt-4 p-3 bg-yellow-900/50 border border-yellow-700 rounded-lg">
                            <h4 className="font-semibold text-warning">Validation Flags</h4>
                            <ul className="list-disc list-inside text-yellow-300 text-sm mt-1">
                                {parsedTrade.validationFlags.map((flag: string, i: number) => <li key={i}>{flag}</li>)}
                            </ul>
                        </div>
                    )}
                    <div className="flex justify-end mt-6">
                         <button onClick={() => setParsedTrade(null)} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg mr-2">Back</button>
                         <button onClick={handleConfirm} className="bg-success hover:bg-green-700 text-white font-bold py-2 px-4 rounded-lg">Confirm & Add Trade</button>
                    </div>
                </div>
            )}
        </Modal>
    );
};


interface TradeExitFormProps {
    trade: ActiveTrade;
    onClose: () => void;
    onConfirmClose: (trade: ClosedTrade) => void;
}

const TradeExitForm: React.FC<TradeExitFormProps> = ({ trade, onClose, onConfirmClose }) => {
    const [form, setForm] = useState({
        exitPrice: '',
        exitReason: ExitReason.ProfitTarget,
        exitReasonDetail: '',
        reviewRight: '',
        reviewWrong: '',
        lessonLearned: '',
        wouldTakeAgain: 'Yes' as 'Yes'|'No',
        wouldTakeAgainReason: '',
        selfRating: 3
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        setForm(prev => ({...prev, [e.target.name]: e.target.value}));
    }

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if(!form.exitPrice) {
            alert("Exit price is required.");
            return;
        }

        const closedTrade: ClosedTrade = {
            ...trade,
            status: 'closed',
            exitData: {
                exitDate: new Date().toISOString(),
                exitPrice: parseFloat(form.exitPrice),
                exitReason: form.exitReason,
                exitReasonDetail: form.exitReasonDetail,
                reviewRight: form.reviewRight,
                reviewWrong: form.reviewWrong,
                lessonLearned: form.lessonLearned,
                wouldTakeAgain: { decision: form.wouldTakeAgain, reason: form.wouldTakeAgainReason },
                selfRating: form.selfRating,
            }
        };

        onConfirmClose(closedTrade);
    }
    
    return (
        <Modal title={`Close Position: ${trade.ticker}`} onClose={onClose}>
            <form onSubmit={handleSubmit} className="space-y-4">
                <Input label="Exit Price" name="exitPrice" type="number" value={form.exitPrice} onChange={handleChange} required />
                 <Select label="Exit Reason" name="exitReason" value={form.exitReason} onChange={handleChange}>
                    {Object.values(ExitReason).map(r => <option key={r} value={r}>{r}</option>)}
                </Select>
                <textarea name="reviewRight" value={form.reviewRight} onChange={handleChange} placeholder="What went RIGHT?" className="w-full p-2 bg-primary border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" rows={3}></textarea>
                <textarea name="reviewWrong" value={form.reviewWrong} onChange={handleChange} placeholder="What went WRONG?" className="w-full p-2 bg-primary border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" rows={3}></textarea>
                <textarea name="lessonLearned" value={form.lessonLearned} onChange={handleChange} placeholder="Lesson learned" className="w-full p-2 bg-primary border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" rows={3}></textarea>
                 <div className="flex justify-end pt-4">
                    <button type="button" onClick={onClose} className="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg mr-2">Cancel</button>
                    <button type="submit" className="bg-danger hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg">Confirm Close</button>
                </div>
            </form>
        </Modal>
    );
}

// --- REUSABLE UI COMPONENTS ---
const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => {
    return (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-secondary rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
                <header className="flex items-center justify-between p-4 border-b border-border-color">
                    <h3 className="text-xl font-bold">{title}</h3>
                    <button onClick={onClose} className="p-1 rounded-full hover:bg-gray-700"><CloseIcon /></button>
                </header>
                <div className="p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
}
const Input: React.FC<InputProps> = ({ label, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
        <input {...props} className="w-full p-2 bg-primary border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-accent" />
    </div>
);

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label: string;
}
const Select: React.FC<SelectProps> = ({ label, children, ...props }) => (
    <div>
        <label className="block text-sm font-medium text-gray-400 mb-1">{label}</label>
        <select {...props} className="w-full p-2 bg-primary border border-border-color rounded-lg focus:outline-none focus:ring-2 focus:ring-accent">
            {children}
        </select>
    </div>
);


const SummaryCard: React.FC<{ title: string; value: string; isPL?: boolean }> = ({ title, value, isPL }) => {
    let valueColor = 'text-gray-200';
    if (isPL) {
        const numericValue = parseFloat(value.replace(/[^0-9.-]+/g,""));
        if (numericValue > 0) valueColor = 'text-success';
        if (numericValue < 0) valueColor = 'text-danger';
    }
    
    return (
        <div className="bg-primary p-4 rounded-lg shadow">
            <h4 className="text-sm text-gray-400">{title}</h4>
            <p className={`text-2xl font-bold ${valueColor}`}>{value}</p>
        </div>
    );
};


interface PositionCardProps {
    trade: ActiveTrade;
    onOpenCloseModal: (trade: ActiveTrade) => void;
}
const PositionCard: React.FC<PositionCardProps> = ({ trade, onOpenCloseModal }) => {
    const currentPrice = trade.currentPrice || trade.entryPrice;
    const pl = calculatePL(trade.entryPrice, currentPrice, trade.shareCount, trade.direction);
    const plPercent = calculatePLPercent(trade.entryPrice, currentPrice, trade.direction);
    const plColor = pl >= 0 ? 'text-success' : 'text-danger';
    const accountColor = {
        [TradeAccount.IncomeGenerator]: 'bg-blue-900/50 text-blue-300',
        [TradeAccount.Speculation]: 'bg-yellow-900/50 text-yellow-300',
        [TradeAccount.TradingLab]: 'bg-purple-900/50 text-purple-300',
        [TradeAccount.Uncategorized]: 'bg-gray-700 text-gray-300',
    }

    return (
        <div className="bg-secondary p-4 rounded-lg shadow flex flex-col justify-between">
            <div>
                <div className="flex justify-between items-start">
                    <div>
                        <h4 className="text-xl font-bold">{trade.ticker}</h4>
                         <p className={`text-xs px-2 py-0.5 rounded-full inline-block mt-1 ${accountColor[trade.account || TradeAccount.Uncategorized]}`}>{trade.account || 'Uncategorized'}</p>
                    </div>
                    <span className={`px-2 py-1 text-xs rounded-full ${trade.direction === 'Long' ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'}`}>
                        {trade.direction}
                    </span>
                </div>
                <div className={`mt-4 text-3xl font-mono text-center font-bold ${plColor}`}>
                    {formatCurrency(pl)}
                    <span className="text-lg ml-2">({formatPercent(plPercent)})</span>
                </div>
                <div className="mt-4 space-y-2 text-sm">
                    <div className="flex justify-between">
                        <span className="text-gray-400">Position Size:</span>
                        <span>{formatCurrency(trade.positionSize)}</span>
                    </div>
                    <div className="flex justify-between">
                        <span className="text-gray-400">Entry / Current:</span>
                        <span>{formatCurrency(trade.entryPrice)} / {formatCurrency(currentPrice)}</span>
                    </div>
                     <div className="flex justify-between">
                        <span className="text-gray-400">Stop Loss:</span>
                        <span className="text-danger">{formatCurrency(trade.stopLoss)}</span>
                    </div>
                </div>
            </div>
            <div className="mt-4 pt-4 border-t border-border-color flex justify-end space-x-2">
                <button className="bg-gray-600 hover:bg-gray-700 text-xs px-3 py-1 rounded">Update Price</button>
                <button onClick={() => onOpenCloseModal(trade)} className="bg-danger hover:bg-red-700 text-xs px-3 py-1 rounded">Close</button>
            </div>
        </div>
    );
}

export default App;
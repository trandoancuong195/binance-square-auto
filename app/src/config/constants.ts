export const TIMEFRAMES = ['15m', '1h', '4h'] as const;
export type Timeframe = typeof TIMEFRAMES[number];
export const STABLE_ASSETS = new Set(['USDT', 'USDC', 'FDUSD', 'TUSD', 'USDP', 'DAI', 'BUSD', 'USDD', 'USD1', 'PYUSD', 'EUR', 'AEUR', 'EURI', 'PAX', 'USTC']);
export const LEVERAGED_ASSETS = new Set(['BTC', 'ETH', 'BNB', 'XRP', 'ADA', 'DOT', 'LINK', 'LTC', 'BCH', 'EOS', 'TRX', 'XTZ', 'YFI', 'SUSHI', 'UNI', '1INCH', 'AAVE', 'FIL'].flatMap(base => ['UP', 'DOWN', 'BULL', 'BEAR'].map(suffix => base + suffix)));
export const SYMBOL_PATTERN = /^[A-Z0-9]{1,20}USDT$/;

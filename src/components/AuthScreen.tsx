import { signInWithPopup } from 'firebase/auth';
import { Globe, Lock, ShieldCheck, UserPlus, Warehouse } from 'lucide-react';
import { useState } from 'react';
import { T } from '../i18n/translations.ts';
import { apiRequest, getErrorMessage, setSessionToken } from '../lib/api.ts';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import type { Lang, UserProfile } from '../types/wms.ts';

interface AuthScreenProps {
  lang: Lang;
  onToggleLang: () => void;
  needsInitialSetup: boolean;
  onAuthenticated: (user: UserProfile) => void;
}

export function AuthScreen({
  lang,
  onToggleLang,
  needsInitialSetup,
  onAuthenticated,
}: AuthScreenProps) {
  const t = T[lang];
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: UserProfile; sessionToken?: string }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ identifier, password }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError(getErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  };

  const handleSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await apiRequest<{ user: UserProfile; sessionToken?: string }>('/api/auth/setup', {
        method: 'POST',
        body: JSON.stringify({ fullName, username, email, password }),
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError(getErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const credential = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await credential.user.getIdToken();
      const res = await apiRequest<{ user: UserProfile; sessionToken?: string }>('/api/auth/firebase-login', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.sessionToken) setSessionToken(res.sessionToken);
      onAuthenticated(res.user);
    } catch (err) {
      setError(getErrorMessage(err, lang));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col lg:flex-row">
      {/* Form Column */}
      <div className="flex-1 flex flex-col justify-between p-6 sm:p-10 lg:p-14 bg-white">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-900 text-white flex items-center justify-center">
              <Warehouse className="w-5 h-5" />
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900">{t.brandName}</div>
              <div className="text-xs text-slate-500">{t.brandSub}</div>
            </div>
          </div>

          <button
            type="button"
            onClick={onToggleLang}
            className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2 cursor-pointer whitespace-nowrap shrink-0"
          >
            <Globe className="w-4 h-4" />
            <span>{lang === 'ar' ? 'English' : 'العربية'}</span>
          </button>
        </div>

        <div className="w-full max-w-md mx-auto my-10">
          <div className="mb-8">
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {needsInitialSetup ? t.setupTitle : t.loginTitle}
            </h1>
            <p className="text-sm text-slate-600 mt-2">
              {needsInitialSetup ? t.setupSubtitle : t.loginSubtitle}
            </p>
          </div>

          {error && (
            <div className="mb-6 p-3.5 bg-red-50 border border-red-200 rounded-lg text-sm font-medium text-red-700">
              {error}
            </div>
          )}

          {needsInitialSetup ? (
            <form onSubmit={handleSetupSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {t.fullName}
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full h-11 px-3.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                  placeholder={lang === 'ar' ? 'مثال: أحمد محمود' : 'e.g. Ahmed Mahmoud'}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    {t.username}
                  </label>
                  <input
                    type="text"
                    required
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    dir="ltr"
                    className="w-full h-11 px-3.5 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:border-slate-900"
                    placeholder="admin"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                    {t.email}
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    dir="ltr"
                    className="w-full h-11 px-3.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                    placeholder="admin@ela-textiles.com"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {t.password}
                </label>
                <input
                  type="password"
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  className="w-full h-11 px-3.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <UserPlus className="w-4 h-4" />
                <span>{loading ? t.loading : t.createAdmin}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {t.usernameOrEmail}
                </label>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  dir="ltr"
                  className="w-full h-11 px-3.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                  placeholder="username / email"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1.5">
                  {t.password}
                </label>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  dir="ltr"
                  className="w-full h-11 px-3.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:border-slate-900"
                  placeholder="••••••••"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-12 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                <span>{loading ? t.loading : t.signIn}</span>
              </button>
            </form>
          )}

          <div className="my-6 flex items-center gap-3">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-xs text-slate-500 font-medium">{t.orDivider}</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          <button
            type="button"
            disabled={loading}
            onClick={() => void handleGoogleSignIn()}
            className="w-full h-11 bg-white border border-slate-300 text-slate-800 rounded-lg text-sm font-semibold hover:bg-slate-50 flex items-center justify-center gap-2.5 cursor-pointer"
          >
            <ShieldCheck className="w-4 h-4 text-slate-700" />
            <span>{t.googleSignIn}</span>
          </button>
        </div>

        <div className="text-xs text-slate-400">
          {lang === 'ar'
            ? 'نظام إدارة المستودع المركزي · إيلا لصناعة المنسوجات'
            : 'Central Warehouse Control · ELA Textile Manufacturing'}
        </div>
      </div>

      {/* Industrial Textile Visual Column */}
      <div className="hidden lg:block lg:w-1/2 relative bg-slate-900 overflow-hidden">
        <img
          src="/src/assets/images/textile_warehouse_hero_1794918827870.jpg"
          alt="ELA Textile Warehouse"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-900/40 to-transparent" />
        <div className="absolute bottom-10 start-10 end-10 text-white">
          <div className="text-xs font-semibold tracking-wider text-slate-300 mb-2">
            {lang === 'ar'
              ? 'مواد خام · منتجات تامة · تتبع بالباركود'
              : 'Raw Materials · Finished Products · Barcode Tracking'}
          </div>
          <h2 className="text-2xl font-bold leading-snug">
            {lang === 'ar'
              ? 'دقة مخزنية فورية من الخيط الخام إلى القماش الجاهز'
              : 'Real-time inventory integrity from raw yarn to finished fabric'}
          </h2>
        </div>
      </div>
    </div>
  );
}

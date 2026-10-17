// ============================================================================
// koshi – Web UI i18n (client-side)
// ============================================================================
// Bilingual support: English (default) / Japanese
// Language is detected from navigator.language, overridable via localStorage
// key 'koshi-lang' ('en' / 'ja').
// ============================================================================

const LOCALES = {
    en: {
        appName: 'koshi',
        navHome: 'Home',
        navFeed: 'Feed',
        navPosts: 'Posts',
        navDMs: 'DMs',
        navSettings: 'Settings',
        navNostr: 'Nostr',
        navP2P: 'P2P',
        btnLogin: 'Login',
        btnRegister: 'Register',
        btnLogout: 'Logout',
        btnPost: 'Post',
        btnSend: 'Send',
        btnCancel: 'Cancel',
        btnSave: 'Save',
        btnDelete: 'Delete',
        btnConfirm: 'Confirm',
        placeholderUsername: 'Username',
        placeholderPassword: 'Password',
        placeholderContent: "What's on your mind?",
        labelServerUrl: 'Server URL',
        labelServerUrlHint: 'Leave empty for serverless (same-origin) mode',
        errNotLoggedIn: 'Not logged in.',
        errFailed: 'Operation failed.',
        errNetwork: 'Network error. Please check your connection.',
        errInvalidInput: 'Invalid input.',
        msgLoggedOut: 'Logged out.',
        msgDeleted: 'Deleted.',
        langEnglish: 'English',
        langJapanese: '日本語',
        langLabel: 'Language',
        pageNotFound: 'Page not found',
        noPosts: 'No posts yet.',
        serverConnected: 'Server connected',
        serverDisconnected: 'Server disconnected',
        nostrConnected: 'Nostr connected',
        p2pActive: 'P2P mesh active',
        p2pInactive: 'P2P mesh inactive',
    },
    ja: {
        appName: 'koshi',
        navHome: 'ホーム',
        navFeed: 'フィード',
        navPosts: '投稿',
        navDMs: 'DM',
        navSettings: '設定',
        navNostr: 'Nostr',
        navP2P: 'P2P',
        btnLogin: 'ログイン',
        btnRegister: '新規登録',
        btnLogout: 'ログアウト',
        btnPost: '投稿',
        btnSend: '送信',
        btnCancel: 'キャンセル',
        btnSave: '保存',
        btnDelete: '削除',
        btnConfirm: '確認',
        placeholderUsername: 'ユーザー名',
        placeholderPassword: 'パスワード',
        placeholderContent: 'どうしてる？',
        labelServerUrl: 'サーバー URL',
        labelServerUrlHint: '空にするとサーバーレスモード（同一オリジン）',
        errNotLoggedIn: 'ログインしていません。',
        errFailed: '操作に失敗しました。',
        errNetwork: 'ネットワークエラー。接続を確認してください。',
        errInvalidInput: '無効な入力です。',
        msgLoggedOut: 'ログアウトしました。',
        msgDeleted: '削除しました。',
        langEnglish: 'English',
        langJapanese: '日本語',
        langLabel: '言語',
        pageNotFound: 'ページが見つかりません',
        noPosts: 'まだ投稿はありません。',
        serverConnected: 'サーバーに接続しました',
        serverDisconnected: 'サーバーから切断されました',
        nostrConnected: 'Nostr に接続しました',
        p2pActive: 'P2P メッシュが有効です',
        p2pInactive: 'P2P メッシュが無効です',
    },
};

let _lang = null;

function detectLang() {
    if (_lang) return _lang;
    // localStorage override
    try {
        const stored = localStorage.getItem('koshi-lang');
        if (stored === 'en' || stored === 'ja') {
            _lang = stored;
            return _lang;
        }
    } catch { /* localStorage unavailable */ }
    // navigator language
    const navLang = typeof navigator !== 'undefined' ? navigator.language : 'en';
    _lang = navLang.startsWith('ja') ? 'ja' : 'en';
    return _lang;
}

export function setLang(lang) {
    if (lang !== 'en' && lang !== 'ja') return;
    _lang = lang;
    try {
        localStorage.setItem('koshi-lang', lang);
    } catch { /* localStorage unavailable */ }
    // Re-render triggered by consumers calling t() after setLang
}

export function getLang() {
    return detectLang();
}

export function t(key, lang) {
    const l = lang || detectLang();
    const locale = LOCALES[l] || LOCALES.en;
    return locale[key] || LOCALES.en[key] || key;
}

export function detectLangSync() {
    return detectLang();
}

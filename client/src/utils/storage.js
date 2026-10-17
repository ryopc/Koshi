const LS = {
  T: 'k:tk',
  U: 'k:u',
  SK: (u) => `k:sk:${u}`,
};

const safeGet = (key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const safeSet = (key, value) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Silently fail - storage not available (private mode, iframe, etc.)
  }
};

const safeRemove = (key) => {
  try {
    localStorage.removeItem(key);
  } catch {
    // Silently fail
  }
};

export const getToken = () => safeGet(LS.T);
export const setToken = (t) => safeSet(LS.T, t);
export const removeToken = () => safeRemove(LS.T);

export const getUser = () => {
  try {
    const data = safeGet(LS.U);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
};
export const setUser = (u) => safeSet(LS.U, JSON.stringify(u));
export const removeUser = () => safeRemove(LS.U);

export const getSK = (u) => safeGet(LS.SK(u));
export const setSK = (u, k) => safeSet(LS.SK(u), k);

export const clearAll = () => {
  const u = getUser();
  if (u) safeRemove(LS.SK(u.username));
  removeToken();
  removeUser();
};

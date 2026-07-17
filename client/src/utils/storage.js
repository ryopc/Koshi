const LS = {
  T: 'k:tk',
  U: 'k:u',
  SK: (u) => `k:sk:${u}`,
};

export const getToken = () => localStorage.getItem(LS.T);
export const setToken = (t) => localStorage.setItem(LS.T, t);
export const removeToken = () => localStorage.removeItem(LS.T);

export const getUser = () => {
  try {
    return JSON.parse(localStorage.getItem(LS.U));
  } catch {
    return null;
  }
};
export const setUser = (u) => localStorage.setItem(LS.U, JSON.stringify(u));
export const removeUser = () => localStorage.removeItem(LS.U);

export const getSK = (u) => localStorage.getItem(LS.SK(u));
export const setSK = (u, k) => localStorage.setItem(LS.SK(u), k);

export const clearAll = () => {
  const u = getUser();
  if (u) localStorage.removeItem(LS.SK(u.username));
  removeToken();
  removeUser();
};

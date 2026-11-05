'use client';

import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import createCache from '@emotion/cache';
import { CacheProvider, InstUISettingsProvider } from '@instructure/emotion';
import { dark, light, type NewThemeOverrideObject } from '@instructure/ui-themes';
import { WORKSPACE_THEME_EVENT, workspaceThemes, type WorkspaceTheme } from '@/features/workspace-ui/theme';

function subscribeToSystemTheme(callback: () => void) {
  if (typeof window.matchMedia !== 'function') return () => {};
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
}
function systemIsDark() { return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches; }

/** Both v11_7 themes keep Academy's teal identity through InstUI's documented token API. */
export function canvasThemeOverride(isDark: boolean): NewThemeOverrideObject {
  const brand = isDark ? '#72d5d7' : '#08666a';
  return {
    semantics: {
      fontFamily: { base: 'Inter, "Be Vietnam Pro", system-ui, sans-serif' },
      color: { institutional: {
        brandPrimary: brand,
        linkColor: brand,
        brandButtonPrimaryBgd: brand,
        brandButtonPrimaryText: isDark ? '#102c31' : '#ffffff',
        brandButtonSecondaryBgd: isDark ? '#292f39' : '#f5f5f7',
        brandButtonSecondaryText: isDark ? '#f0f2f5' : '#27313b',
      } },
    },
    sharedTokens: { focusOutline: { infoColor: brand } },
    // InstUI's default 20% lightening makes white text fail 4.5:1 on Academy teal.
    // Keep the actual component's hover/pressed states within the brand palette.
    components: { ProgressBar: {
      meterColorBrand: brand, meterColorInfo: brand, meterColorSuccess: brand,
      borderColor: brand, trackColor: isDark ? '#203e43' : '#e9f4f4',
      borderRadius: '4px', textColor: isDark ? '#b3bdc9' : '#596570',
    }, TextInput: { borderRadius: '4px' }, TextArea: { borderRadius: '4px' }, BaseButton: {
      borderRadius: '4px', borderRadiusSm: '4px',
      primaryHoverBackground: isDark ? '#8de1e2' : '#075a5e', primaryHoverBorderColor: isDark ? '#8de1e2' : '#075a5e',
      primaryActiveBackground: isDark ? '#58bfc2' : '#064d53', primaryActiveBorderColor: isDark ? '#58bfc2' : '#064d53',
      secondaryHoverBackground: isDark ? '#394350' : '#e8ebef',
      secondaryActiveBackground: isDark ? '#414d5c' : '#dce1e7',
    } },
  };
}

/** Emotion's streaming-compatible inline SSR styles are hydrated by the same per-tree cache. */
export function CanvasProvider({ children, theme = 'system' }: { children: ReactNode; theme?: WorkspaceTheme }) {
  const prefersDark = useSyncExternalStore(subscribeToSystemTheme, systemIsDark, () => false);
  const [liveTheme, setLiveTheme] = useState<{ base: WorkspaceTheme; value: WorkspaceTheme } | null>(null);
  useEffect(() => {
    const apply = (event: Event) => {
      const value = (event as CustomEvent<WorkspaceTheme>).detail;
      if (workspaceThemes.includes(value)) setLiveTheme({ base: theme, value });
    };
    window.addEventListener(WORKSPACE_THEME_EVENT, apply);
    window.addEventListener('vf-staff-theme', apply);
    return () => { window.removeEventListener(WORKSPACE_THEME_EVENT, apply); window.removeEventListener('vf-staff-theme', apply); };
  }, [theme]);
  const chosenTheme = liveTheme?.base === theme ? liveTheme.value : theme;
  const isDark = chosenTheme === 'dark' || chosenTheme === 'system' && prefersDark;
  const [cache] = useState(() => createCache({ key: 'academy-instui' }));
  return <CacheProvider value={cache}><InstUISettingsProvider theme={isDark ? dark : light} themeOverride={canvasThemeOverride(isDark)}>{children}</InstUISettingsProvider></CacheProvider>;
}

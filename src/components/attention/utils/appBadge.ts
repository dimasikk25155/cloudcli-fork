/**
 * Number on the installed app icon (Badging API). Works on desktop PWAs and
 * iOS home-screen apps; Android Chrome/TWA has no Badging API — there the
 * launcher dot comes from the pending "нужен ответ" notifications instead.
 */
export type BadgeNavigator = {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

const ignoreBadgeFailure = (): void => {
  // Badge is decorative: permission/visibility refusals must not break the app.
};

export function applyAppBadge(count: number, nav: BadgeNavigator | undefined = defaultNavigator()): void {
  if (!nav) {
    return;
  }
  try {
    if (count > 0) {
      nav.setAppBadge?.(count)?.catch(ignoreBadgeFailure);
    } else if (nav.clearAppBadge) {
      nav.clearAppBadge()?.catch(ignoreBadgeFailure);
    } else {
      nav.setAppBadge?.(0)?.catch(ignoreBadgeFailure);
    }
  } catch {
    // Some browsers throw synchronously when the document is not allowed to badge.
    ignoreBadgeFailure();
  }
}

function defaultNavigator(): BadgeNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as unknown as BadgeNavigator);
}

export interface MobileAuthUser {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export type MobileAuthState =
  | { status: "signedOut" }
  | { status: "signingIn"; user: MobileAuthUser | null }
  | { status: "signedIn"; user: MobileAuthUser }
  | { status: "error"; message: string; user: MobileAuthUser | null };

export interface EmailPasswordSignInInput {
  email: string;
  password: string;
}

export interface MobileAuthSdk {
  getCurrentUser(): MobileAuthUser | null;
  onAuthStateChanged(listener: (user: MobileAuthUser | null) => void): () => void;
  signInWithEmailPassword(email: string, password: string): Promise<MobileAuthUser>;
  signOut(): Promise<void>;
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
}

export interface MobileAuthSession {
  initialize(): Promise<void>;
  getState(): MobileAuthState;
  subscribe(listener: (state: MobileAuthState) => void): () => void;
  signInWithEmailPassword(input: EmailPasswordSignInInput): Promise<void>;
  signOut(): Promise<void>;
  getIdToken(forceRefresh?: boolean): Promise<string | null>;
}

interface MobileAuthSessionDeps {
  sdk: MobileAuthSdk;
}

export function createMobileAuthSession({
  sdk
}: MobileAuthSessionDeps): MobileAuthSession {
  let state: MobileAuthState = normalizeUserState(sdk.getCurrentUser());
  let unsubscribeFromSdk: (() => void) | null = null;
  const listeners = new Set<(state: MobileAuthState) => void>();

  const publish = (nextState: MobileAuthState) => {
    state = nextState;
    for (const listener of listeners) {
      listener(state);
    }
  };

  const ensureSubscribed = () => {
    if (unsubscribeFromSdk) {
      return;
    }

    unsubscribeFromSdk = sdk.onAuthStateChanged((user) => {
      publish(normalizeUserState(user));
    });
  };

  return {
    async initialize() {
      ensureSubscribed();
    },
    getState() {
      return state;
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => {
        listeners.delete(listener);
      };
    },
    async signInWithEmailPassword(input) {
      publish({
        status: "signingIn",
        user: state.status === "signedIn" ? state.user : null
      });

      try {
        const user = await sdk.signInWithEmailPassword(input.email, input.password);
        publish({ status: "signedIn", user });
      } catch (error) {
        publish({
          status: "error",
          message: error instanceof Error ? error.message : "Sign-in failed",
          user: null
        });
      }
    },
    async signOut() {
      await sdk.signOut();
      publish({ status: "signedOut" });
    },
    getIdToken(forceRefresh) {
      return sdk.getIdToken(forceRefresh);
    }
  };
}

export function createDisabledMobileAuthSession(): MobileAuthSession {
  const sdk: MobileAuthSdk = {
    getCurrentUser: () => null,
    onAuthStateChanged: (listener) => {
      listener(null);
      return () => undefined;
    },
    signInWithEmailPassword: async () => {
      throw new Error("Firebase Auth is not configured.");
    },
    signOut: async () => undefined,
    getIdToken: async () => null
  };

  return createMobileAuthSession({ sdk });
}

function normalizeUserState(user: MobileAuthUser | null): MobileAuthState {
  return user ? { status: "signedIn", user } : { status: "signedOut" };
}

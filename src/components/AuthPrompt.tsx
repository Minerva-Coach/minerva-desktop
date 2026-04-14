interface AuthPromptProps {
  onLogin: () => void;
}

/**
 * Small sign-in prompt shown when the user hasn't authenticated.
 * Click-through is disabled by the parent Overlay when this is rendered.
 */
export function AuthPrompt({ onLogin }: AuthPromptProps) {
  return (
    <div className="flex items-center justify-center h-full">
      <button
        onClick={onLogin}
        className="
          px-4 py-2 rounded-xl
          bg-black/70 backdrop-blur-sm
          text-white text-sm font-medium
          border border-white/20
          hover:bg-black/90 hover:border-white/40
          transition-all duration-200
          cursor-pointer shadow-lg
        "
      >
        Sign in to Minerva
      </button>
    </div>
  );
}

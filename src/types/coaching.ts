/** Coaching message from Flask-SocketIO. */
export interface CoachingMessage {
  user_id: number;
  meeting_id: number;
  text: string;
  message_type:
    | "coaching_tip"
    | "positive_reinforcement"
    | "warning"
    | "summary"
    | "insight"
    | "question"
    | "onboarding"
    | "priority_message";
  priority: "urgent" | "normal" | "low";
  timestamp: string;
  color?: "red" | "orange" | "yellow" | "blue" | "black";
  auto_dismiss_seconds?: number;
  metadata?: {
    behavior?: string;
    behavior_name?: string;
    utterance_text?: string;
    [key: string]: unknown;
  };
}

/** Companion chart data update from Flask-SocketIO. */
export interface CompanionDataUpdate {
  meeting_id: number;
  data: {
    talk_time: {
      me: number;
      others: number;
      silence: number;
    };
    behaviors: Array<{
      name: string;
      count: number;
      target: number;
    }>;
    filler_words: {
      fraction: number;
      top_2: string[];
    };
    focus_goals: Array<{
      id: number;
      title: string;
      current_count: number;
      target_count: number;
      completed: boolean;
    }>;
  };
  timestamp: string;
}

/** Auth result event from Rust backend. */
export interface AuthResult {
  success: boolean;
  error?: string;
}

/** Platform context shown in the Connection Issue modal. */
export interface DiagnosticContext {
  app_version: string;
  os: string;
  arch: string;
  os_version: string;
  api_url: string;
  has_token: boolean;
}

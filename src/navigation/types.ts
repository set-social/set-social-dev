import type { NavigatorScreenParams } from '@react-navigation/native';
import type { WorkoutVariantType } from '../types/database';
import type { SingleWorkoutPayload, WeeklyPlanPayload } from '../services/api/queries/workoutShares';
import type { CardioActivityKey } from '../utils/cardioCalories';

// ---- Auth ----
export type AuthStackParamList = {
  Welcome: undefined;
  SignIn: undefined;
  SignUp: undefined;
  ForgotPassword: undefined;
};

// ---- Onboarding ----
export type OnboardingStackParamList = {
  Goals: undefined;
  BodyProfile: undefined;
  ExperienceLevel: undefined;
  DaysPerWeek: undefined;
  Equipment: undefined;
  Injuries: undefined;
  BuildFirstWeek: undefined;
};

// ---- Today tab ----
export type TodayStackParamList = {
  Today: undefined;
  ProgramDetail: { programId: string };
  /** `date` (yyyy-MM-dd) is the calendar day this program day is being viewed
   * for — used to grey out "Start Workout" when the viewed day hasn't
   * arrived yet. Omitted when there's no specific date in view (e.g. reached
   * outside a weekday/calendar context), in which case the screen has no
   * future-day check to make. */
  DayDetail: { programDayId: string; date?: string };
  ExerciseDetail: { exerciseId: string };
  TrainingDayDetail: { weeklyScheduleId: string; workoutTemplateId: string; dayOfWeek: number };
  LogFood: undefined;
};

// ---- Training tab (formerly Programs + the standalone Log tab — Log's
// screens moved here when the tab bar was redesigned to make room for a
// permanent Arnold slot; see MainTabs/ArnoldTabButton) ----
export type ProgramsStackParamList = {
  Calendar: undefined;
  ProgramDetail: { programId: string };
  /** `date` (yyyy-MM-dd) is the calendar day this program day is being viewed
   * for — used to grey out "Start Workout" when the viewed day hasn't
   * arrived yet. Omitted when there's no specific date in view (e.g. reached
   * outside a weekday/calendar context), in which case the screen has no
   * future-day check to make. */
  DayDetail: { programDayId: string; date?: string };
  ExercisePicker: { selectMode?: boolean; templateId?: string; programDayId?: string } | undefined;
  AddExercise: { selectMode?: boolean; templateId?: string; programDayId?: string } | undefined;
  ExerciseDetail: { exerciseId: string };
  /** `date` (yyyy-MM-dd) preselects the schedule date in pick mode — used
   * by CalendarScreen's "Change Workout" actions so picking a template
   * schedules straight onto the day that was tapped, instead of defaulting
   * to today and making the athlete reset the date themselves. Omitted
   * (defaults to today) everywhere else Library is reached.
   * `replaceScheduledWorkoutId`: when the tapped day already had its own
   * one-off `scheduled_workouts` row (not a recurring/program day), that
   * row's id — LibraryScreen deletes it before inserting the new one, since
   * `scheduled_workouts` has no unique constraint on (user, date) and a
   * second insert would leave a stale duplicate rather than replacing it. */
  Library: { pickMode?: boolean; date?: string; replaceScheduledWorkoutId?: string } | undefined;
  /** `date`/`replaceScheduledWorkoutId` — same meaning and reasoning as
   * `Library`'s own params (see below): preset the "Schedule This Workout"
   * date to a specific day (CalendarScreen's "Create New Workout" action)
   * instead of defaulting to today, and delete an existing one-off
   * scheduled_workouts row on that date before creating the new one. Only
   * meaningful alongside `scheduleAfterSave: true`. */
  TemplateEditor:
    | { templateId?: string; scheduleAfterSave?: boolean; date?: string; replaceScheduledWorkoutId?: string }
    | undefined;
  ScheduledWorkoutDetail: { scheduledWorkoutId: string };
  GenerateProgram: { daysPerWeek: number; weeksCount: number; focusNotes?: string; emphasisMuscleGroups?: string[] };
  AssignTrainingDay: { initialDayOfWeek?: number } | undefined;
  AssignCardioDay: { initialDayOfWeek?: number } | undefined;
  TrainingDayDetail: { weeklyScheduleId: string; workoutTemplateId: string; dayOfWeek: number };
  WorkoutLogDetail: { workoutLogIds: string[]; title?: string | null; dateLabel?: string };
  /** Recipient picker for sending a workout/weekly-plan share — reached from
   * a workout screen's "Share this workout" action or Calendar's "Share my
   * week." Carries the already-built snapshot directly (not an id): nothing
   * exists in the DB yet at this point, the data is already in memory on
   * the sender's device. */
  ShareWorkout:
    | { shareType: 'single_workout'; title: string; payload: SingleWorkoutPayload }
    | { shareType: 'weekly_plan'; title: string; payload: WeeklyPlanPayload };
  PreWorkoutReview: { programDayId?: string; scheduledWorkoutId?: string };
  ChooseVariant: { programDayId?: string; scheduledWorkoutId?: string };
  ActiveWorkoutOverview:
    | { programDayId?: string; scheduledWorkoutId?: string; templateId?: string; variantType?: WorkoutVariantType }
    | undefined;
  ActiveExercise: { exerciseId: string };
  FormCheck: { exerciseId: string; exerciseName: string };
  WorkoutSummary: undefined;
  /** No scheduledWorkoutId — v1 has no one-off cardio scheduling, only
   * recurring (weekly_schedule) and AI-program (program_days) cardio days.
   * `date` (yyyy-MM-dd) is which calendar day this session is being logged
   * for — omitted when logging from a "start now" entry point, in which
   * case it defaults to today. */
  LogCardio: { programDayId?: string; date?: string } | undefined;
  /** GPS-tracked live session — see docs/gps-cardio.md. Only reachable from
   * LogCardio's "Track Live" choice for run/walk/bike activities;
   * everything else stays on the manual LogCardio form untouched.
   * `exerciseId`/`customActivityName` mirror LogCardio's own save-time
   * shape so the eventual save call needs no extra lookup. */
  LiveCardioTracking: {
    programDayId?: string;
    date?: string;
    activityKey: CardioActivityKey;
    exerciseId: string | null;
    customActivityName: string | null;
  };
  /** Reads its data from activeCardioStore (post finishSession), not route
   * params — same "screen reads the active session store" pattern
   * WorkoutSummaryScreen already uses for store.exercises. */
  CardioRunSummary: undefined;
};

// ---- Progress tab ----
export type ProgressStackParamList = {
  ProgressDashboard: undefined;
  PRDetail: { exerciseId: string };
  BodyMetrics: undefined;
  ProgressTimeline: undefined;
  CoachingHistory: undefined;
  CoachingSummaryDetail: { workoutLogId: string };
};

// ---- Community tab ----
export type CommunityStackParamList = {
  Leaderboard: undefined;
  Posts: undefined;
  FriendProfile: { userId: string };
  FriendRequests: undefined;
  PostDetail: { postId: string };
  UploadPhotoPost: {
    mode: 'progress' | 'before_after';
    /** Pre-attached when reached via the Social tab's new-post FAB, which
     * already captured/picked the photo itself — the screen skips straight
     * to caption/tags instead of showing its own picker again. */
    initialPhoto?: { uri: string; contentType: string };
  };
  /** GymBee's relationship model is a mutual "Friends" graph (see
   * FriendsListScreen) — a single label, not separate Followers/Following
   * lists that would just show identical content under different names. */
  FriendsList: { userId: string; title: 'Friends' };
  Messages: undefined;
  Conversation: { conversationId: string };
  /** Reached by tapping a shared-workout card inside Conversation — fetches
   * by id (the share already exists in the DB by this point), unlike
   * ShareWorkout above which carries data that doesn't exist yet. */
  SharedWorkoutReview: { shareId: string };
  AtMyGym: undefined;
  /** Reposition (and optionally upload) the signed-in athlete's own profile
   * photo. `pickedUri`/`contentType` are only present when reached right
   * after picking a brand new photo (not yet uploaded) — omitted when
   * reframing the photo already saved on the profile. */
  AvatarPosition: { pickedUri?: string; contentType?: string } | undefined;
};

// ---- Profile (pushed from the header menu, not a tab) ----
export type ProfileStackParamList = {
  Settings: undefined;
  NotificationSettings: undefined;
  Account: undefined;
  Privacy: undefined;
  BlockedUsers: undefined;
  /** status/message are only ever populated when this screen is reached via
   * the soset://whoop-callback deep link — see RootNavigator's `linking`
   * config. The Integrations screen still re-derives the real connection
   * state from the database on focus; these params only drive the one-time
   * confirmation toast. */
  Integrations: { status?: 'success' | 'error'; message?: string } | undefined;
  Equipment: undefined;
  PostDetail: { postId: string };
  FriendsList: { userId: string; title: 'Friends' };
  /** Reachable from PostDetail's comment rows (tapping a commenter's
   * avatar/handle) when PostDetail itself was reached via this stack
   * (viewing one of your own posts from the Profile tab) — without this,
   * that tap silently fails to navigate. Same reasoning extends one hop
   * further: FriendProfile's "Message" button and Conversation's shared-
   * workout card both need their own targets registered here too, or the
   * exact same class of dead-end resurfaces on the very next tap. */
  FriendProfile: { userId: string };
  Conversation: { conversationId: string };
  SharedWorkoutReview: { shareId: string };
  /** FriendProfile's own isSelf branch (viewing your own profile from this
   * stack) can lead here too — its avatar tap and "add post" action, same
   * dead-end class as the group above if left unregistered. */
  AvatarPosition: { pickedUri?: string; contentType?: string } | undefined;
  UploadPhotoPost: {
    mode: 'progress' | 'before_after';
    initialPhoto?: { uri: string; contentType: string };
  };
};

export type MainTabParamList = {
  TodayTab: NavigatorScreenParams<TodayStackParamList>;
  ProgramsTab: NavigatorScreenParams<ProgramsStackParamList>;
  /** Not a real destination — ArnoldTabButton's tabPress listener always
   * preventDefaults this and opens the root-level Chat screen instead, so
   * this route never actually gets focused/rendered. It still needs a
   * param type and a (never-shown) screen component registered because
   * bottom-tabs requires every visual slot in the bar to be a real
   * Tab.Screen. */
  ArnoldTab: undefined;
  ProgressTab: NavigatorScreenParams<ProgressStackParamList>;
  CommunityTab: NavigatorScreenParams<CommunityStackParamList>;
};

// ---- Root ----
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  Onboarding: NavigatorScreenParams<OnboardingStackParamList>;
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  Profile: NavigatorScreenParams<ProfileStackParamList>;
  Chat: {
    conversationId?: string;
    /** Set by the "Log Food" deep link from the Home Screen widget (see
     * WIDGET_LOG_FOOD_DEEP_LINK) — focuses the input on mount instead of
     * prefilling literal text a photo/typed description would just
     * replace. Read once; ChatScreen doesn't persist or echo it. */
    openFoodLog?: boolean;
  } | undefined;
  /** Registered at the root (not nested in any one stack) so every gated
   * feature — AI Chat, analytics, the widget, program regen — can reach it
   * the same way regardless of which stack it's pushed from:
   * rootNavigation.navigate('Paywall'). `trigger` only affects the copy
   * shown, purely for context ("why am I seeing this") — not enforcement,
   * which always happens server-side via is_premium. */
  Paywall:
    | {
        trigger?:
          | 'ai_chat'
          | 'analytics'
          | 'widget'
          | 'program_regen'
          | 'adaptive_coaching'
          | 'form_check'
          // Deep-linked from the welcome email's CTA (soset://paywall) —
          // see send-welcome-email/index.ts and the linking config in
          // RootNavigator.tsx. Untyped at the URL itself (deep links are
          // just query strings), so this only matters for the copy lookup
          // below actually finding a match.
          | 'welcome_email';
      }
    | undefined;
  /** Registered at the root, same reasoning as Chat/Paywall above — the
   * push notification that opens this can land while the athlete is on any
   * screen, not just inside ProgramsStack (see send-push's resolveSpotRequest
   * and navigationRef's 'SpotRequest' case). */
  SpotRequest: { requestId: string };
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type, @typescript-eslint/no-namespace
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

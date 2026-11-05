import { fixtureScenario, fixtureLearnerName } from '../../learner-harness/src/scenarios';
import { readLearnerHome as scenarioHome } from '../../learner-harness/src/data';
export async function readLearnerHome() { if (fixtureScenario() !== 'baseline') return scenarioHome(); return { continueLearning: { courseId: 'ai-basics', itemId: 'lesson-1', itemTitle: 'First lesson', courseTitle: 'AI foundations', kind: 'lesson' }, nextRequired: null, upcomingExam: null, feedback: null, rewards: { profile: { displayName: fixtureLearnerName(), handle: null }, xpTotal: 220, streak: { current: 3 }, certificates: [] } }; }

export async function readLearnerRewards() { return {profile:{displayName:'Fixture Student',handle:'fixture-student',locale:'en',avatarUrl:null},xpTotal:220,certificates:[]}; }

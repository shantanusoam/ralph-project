const PRESETS = {
  feature: {
    description: 'Balanced feature delivery with validation enabled.',
    validate: true,
    review: false,
    designMode: false,
    iterations: 8,
    circuitBreakerFailures: 3,
    circuitBreakerErrors: 5,
    promptSuffix: 'PRESET: FEATURE. Build the next user-facing capability and keep changes incremental.',
  },
  debug: {
    description: 'Bias toward root-cause analysis and tighter failure loops.',
    validate: true,
    review: false,
    designMode: false,
    iterations: 6,
    circuitBreakerFailures: 2,
    circuitBreakerErrors: 3,
    promptSuffix: 'PRESET: DEBUG. Reproduce the issue, identify the root cause, and prefer narrow fixes with evidence.',
  },
  review: {
    description: 'Favor correctness, review gates, and cautious completion.',
    validate: true,
    review: true,
    designMode: false,
    iterations: 5,
    circuitBreakerFailures: 2,
    circuitBreakerErrors: 3,
    requireExitSignal: true,
    promptSuffix: 'PRESET: REVIEW. Prioritize correctness, explicit verification, and conservative task completion.',
  },
  design: {
    description: 'Frontend and design-focused execution with design skill injection.',
    validate: true,
    review: false,
    designMode: true,
    iterations: 6,
    circuitBreakerFailures: 3,
    circuitBreakerErrors: 4,
    promptSuffix: 'PRESET: DESIGN. Preserve visual quality, consistency, and frontend ergonomics.',
  },
  refactor: {
    description: 'Safer cleanup with stronger validation and moderate iteration count.',
    validate: true,
    review: true,
    designMode: false,
    iterations: 7,
    circuitBreakerFailures: 2,
    circuitBreakerErrors: 4,
    promptSuffix: 'PRESET: REFACTOR. Improve structure without changing behavior unless the task explicitly requires it.',
  },
};

const resolvePreset = (name) => {
  if (!name) return null;
  return PRESETS[name] || null;
};

module.exports = {
  PRESETS,
  resolvePreset,
};

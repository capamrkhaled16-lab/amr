import { motion } from 'framer-motion';
import { Check, ChevronLeft } from 'lucide-react';

export type StepperStep = {
  id: string;
  label: string;
};

type StepperProps = {
  steps: StepperStep[];
  current: number;
  onStepClick?: (index: number) => void;
};

export default function Stepper({ steps, current, onStepClick }: StepperProps) {
  return (
    <div className="flex items-center justify-center gap-1 sm:gap-2 flex-wrap py-4">
      {steps.map((step, i) => {
        const isComplete = i < current;
        const isActive = i === current;
        const isClickable = onStepClick && i <= current;

        return (
          <div key={step.id} className="flex items-center">
            <button
              onClick={() => isClickable && onStepClick?.(i)}
              disabled={!isClickable}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-sm font-semibold transition-all ${
                isActive
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/40'
                  : isComplete
                    ? 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                    : 'glass-light text-slate-500'
              } ${isClickable ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span
                className={`w-6 h-6 rounded-full flex items-center justify-center text-xs ${
                  isActive
                    ? 'bg-white/20'
                    : isComplete
                      ? 'bg-emerald-500/20'
                      : 'bg-white/5'
                }`}
              >
                {isComplete ? <Check size={14} /> : i + 1}
              </span>
              <span className="hidden sm:inline">{step.label}</span>
            </button>
            {i < steps.length - 1 && (
              <ChevronLeft
                size={16}
                className={`mx-1 ${isComplete ? 'text-emerald-500' : 'text-slate-700'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

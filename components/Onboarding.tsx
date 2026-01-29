
import React from 'react';
import { Gender } from '../types';

interface OnboardingProps {
  onSelect: (gender: Gender) => void;
}

const Onboarding: React.FC<OnboardingProps> = ({ onSelect }) => {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-12">
      <div className="space-y-4">
        <h2 className="text-4xl font-black text-slate-800 tracking-tighter">Namaste.</h2>
        <p className="text-slate-500 text-sm max-w-xs mx-auto leading-relaxed">
          Main Sahara hoon. Aapka apna virtual support system. Aap kisse baat karna chahenge?
        </p>
      </div>

      <div className="w-full space-y-4">
        <button 
          onClick={() => onSelect('female')}
          className="w-full group relative overflow-hidden glass p-6 rounded-3xl flex items-center gap-4 transition-all hover:scale-[1.02] hover:shadow-xl active:scale-95"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-rose-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-16 h-16 bg-rose-100 rounded-2xl flex items-center justify-center text-3xl shadow-inner relative z-10">👩‍💼</div>
          <div className="text-left relative z-10">
            <h3 className="font-bold text-slate-800 text-lg">Badi Behen</h3>
            <p className="text-xs text-rose-500 font-medium">Pyari & Samjhdar Awaaz</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-auto text-slate-300 group-hover:text-rose-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        <button 
          onClick={() => onSelect('male')}
          className="w-full group relative overflow-hidden glass p-6 rounded-3xl flex items-center gap-4 transition-all hover:scale-[1.02] hover:shadow-xl active:scale-95"
        >
          <div className="absolute inset-0 bg-gradient-to-r from-indigo-50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center text-3xl shadow-inner relative z-10">👨‍💼</div>
          <div className="text-left relative z-10">
            <h3 className="font-bold text-slate-800 text-lg">Bada Bhai</h3>
            <p className="text-xs text-indigo-500 font-medium">Himmat Wali & Protective Awaaz</p>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 ml-auto text-slate-300 group-hover:text-indigo-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="pt-8 border-t border-slate-200 w-full">
        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
          Safe • Confidential • Non-Judgmental
        </p>
      </div>
    </div>
  );
};

export default Onboarding;

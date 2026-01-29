
import React from 'react';
import { ViewMode, Gender } from '../types';

interface HeaderProps {
  viewMode: ViewMode;
  onReset: () => void;
  onToggleVoice: () => void;
  gender: Gender;
}

const Header: React.FC<HeaderProps> = ({ viewMode, onReset, onToggleVoice, gender }) => {
  const themeClass = gender === 'female' ? 'text-rose-600' : 'text-indigo-600';
  const themeBg = gender === 'female' ? 'bg-rose-100' : 'bg-indigo-100';
  
  return (
    <header className="glass sticky top-0 z-50 p-4 flex items-center justify-between border-b border-white/20">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-2xl flex items-center justify-center transition-all duration-500 shadow-sm ${gender ? themeBg : 'bg-slate-100'}`}>
          <span className={`font-black text-xl ${gender ? themeClass : 'text-slate-400'}`}>S</span>
        </div>
        <div>
          <h1 className="font-bold text-slate-900 text-lg tracking-tight">Sahara</h1>
          {gender && (
            <p className={`text-[9px] font-black uppercase tracking-widest ${themeClass}`}>
              {gender === 'female' ? 'Badi Behen' : 'Bada Bhai'} Mode
            </p>
          )}
        </div>
      </div>

      <div className="flex gap-1">
        {gender && viewMode !== 'onboarding' && (
          <button 
            onClick={onToggleVoice}
            className={`flex items-center gap-2 px-4 py-2 rounded-xl transition-all font-bold text-[11px] uppercase tracking-wider ${viewMode === 'voice' ? 'bg-slate-900 text-white shadow-lg' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
          >
            {viewMode === 'voice' ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                On Call
              </>
            ) : (
              <>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Call
              </>
            )}
          </button>
        )}
        {gender && (
          <button 
            onClick={onReset} 
            className="text-slate-300 hover:text-red-500 p-2 transition-colors rounded-xl hover:bg-red-50"
            title="Start New Session"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>
    </header>
  );
};

export default Header;

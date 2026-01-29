
import React, { useState } from 'react';
import { GoogleGenAI } from "@google/genai";
import { Gender, Message, ViewMode } from './types';
import ChatInterface from './components/ChatInterface';
import Onboarding from './components/Onboarding';
import Header from './components/Header';
import VoiceCall from './components/VoiceCall';

const App: React.FC = () => {
  const [gender, setGender] = useState<Gender>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('onboarding');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);

  const handleGenderSelect = (selectedGender: Gender) => {
    setGender(selectedGender);
    setViewMode('chat');
    
    const initialText = selectedGender === 'female' 
      ? "Hey meri pyaari behen, main Sahara hoon. Main dekh rahi hoon ki tum thodi pareshan ho. Dekho, tum yahan mujhse khul kar baat kar sakti ho. Main tumhari badi behen ki tarah tumhari baat sunne ke liye yahan hoon. Kya hua hai? Relax hokar batao."
      : "Hey mere bhai, main Sahara hoon. Main dekh raha hoon ki tum thode pareshan ho. Dekho, tum yahan mujhse khul kar baat kar sakte ho. Main tumhare bade bhai ki tarah tumhari baat sunne ke liye yahan hoon. Kya baat hai? Batao mujhe.";
    
    setMessages([{
      id: 'initial',
      role: 'model',
      text: initialText,
      timestamp: new Date()
    }]);
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const persona = gender === 'female' ? "Empathetic Elder Sister (Badi Behen)" : "Empathetic Elder Brother (Bada Bhai)";
      
      const systemInstruction = `
        Role: You are a ${persona} named Sahara. 
        Audience: A young person in India seeking support.
        Goal: Provide emotional support and guidance.
        Tone: Protective, empathetic, non-judgmental. Use "Main hoon na", "Daro mat".
        Language: Hinglish.
        Instructions: Stand by them, listen fully, clear guilt ("Galti tumhari nahi hai"), suggest small steps.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: messages.concat(userMessage).map(m => ({
          role: m.role,
          parts: [{ text: m.text }]
        })),
        config: { systemInstruction, temperature: 0.7 }
      });

      const aiText = response.text || "I'm listening, please continue...";
      
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: aiText,
        timestamp: new Date()
      }]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsTyping(false);
    }
  };

  const handleReset = () => {
    if (window.confirm("Conversation clear karein?")) {
      setGender(null);
      setMessages([]);
      setViewMode('onboarding');
    }
  };

  return (
    <div className="relative flex flex-col h-screen max-w-lg mx-auto bg-slate-50 shadow-2xl overflow-hidden border-x border-slate-200">
      {/* Background Drift Blobs */}
      <div 
        className={`drift-blob w-72 h-72 top-20 -left-20 rounded-full transition-colors duration-1000 ${gender === 'female' ? 'bg-rose-300' : 'bg-indigo-300'}`}
      />
      <div 
        className={`drift-blob w-80 h-80 bottom-20 -right-20 rounded-full transition-colors duration-1000 ${gender === 'female' ? 'bg-pink-300' : 'bg-blue-300'}`}
        style={{ animationDelay: '5s' }}
      />

      <Header 
        viewMode={viewMode} 
        onReset={handleReset} 
        onToggleVoice={() => setViewMode(prev => prev === 'voice' ? 'chat' : 'voice')}
        gender={gender}
      />
      
      <main className="flex-1 overflow-hidden relative flex flex-col">
        {viewMode === 'onboarding' && <Onboarding onSelect={handleGenderSelect} />}
        
        {viewMode === 'chat' && (
          <ChatInterface 
            messages={messages} 
            isTyping={isTyping} 
            onSend={handleSendMessage} 
            gender={gender}
            onStartVoice={() => setViewMode('voice')}
          />
        )}

        {viewMode === 'voice' && (
          <VoiceCall 
            gender={gender} 
            onClose={() => setViewMode('chat')} 
          />
        )}
      </main>

      <footer className="glass p-2 text-center text-[10px] text-gray-400 border-t">
        Sahara: Your Safe Haven. Aap akele nahi hain.
      </footer>
    </div>
  );
};

export default App;

import React from 'react';
import { Icon } from './Icon';

export const PaperAirplaneIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <path d="M22 2L11 13" />
    <path d="M22 2L15 22L11 13L2 9L22 2Z" />
  </Icon>
);

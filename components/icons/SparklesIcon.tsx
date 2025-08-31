
import React from 'react';
import { Icon } from './Icon';

export const SparklesIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <path d="M12 2L9.5 9.5 2 12l7.5 2.5L12 22l2.5-7.5L22 12l-7.5-2.5L12 2z" />
  </Icon>
);

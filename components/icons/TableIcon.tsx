
import React from 'react';
import { Icon } from './Icon';

export const TableIcon: React.FC<{ className?: string }> = ({ className }) => (
  <Icon className={className}>
    <path d="M4 3h16a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"></path>
    <path d="M4 9h16"></path>
    <path d="M10 9v12"></path>
  </Icon>
);

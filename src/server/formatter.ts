import { TextEdit, Range } from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

export function formatGherkinDocument(document: TextDocument): TextEdit[] {
  const text = document.getText();
  const formatted = formatGherkin(text);
  
  if (formatted === text) {
    return [];
  }

  const fullRange: Range = {
    start: { line: 0, character: 0 },
    end: document.positionAt(text.length)
  };

  return [TextEdit.replace(fullRange, formatted)];
}

export function formatGherkin(content: string): string {
  const lines = content.split(/\r?\n/);
  const output: string[] = [];

  let expectedIndent = 0;
  let inDocString = false;
  let docStringIndent = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Handle docstrings (""" or ```)
    if (trimmed.startsWith('"""') || trimmed.startsWith('```')) {
      if (!inDocString) {
        inDocString = true;
        docStringIndent = 6;
        output.push(' '.repeat(docStringIndent) + trimmed);
      } else {
        inDocString = false;
        output.push(' '.repeat(docStringIndent) + trimmed);
      }
      continue;
    }

    if (inDocString) {
      output.push(line);
      continue;
    }

    if (trimmed === '') {
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
      continue;
    }

    // Determine indentation based on keyword (English and Spanish)
    if (trimmed.startsWith('Feature:') || trimmed.startsWith('Característica:')) {
      expectedIndent = 0;
    } else if (
      trimmed.startsWith('Rule:') ||
      trimmed.startsWith('Regla:') ||
      trimmed.startsWith('Background:') ||
      trimmed.startsWith('Antecedentes:') ||
      trimmed.startsWith('Scenario:') ||
      trimmed.startsWith('Escenario:') ||
      trimmed.startsWith('Scenario Outline:') ||
      trimmed.startsWith('Esquema del escenario:') ||
      trimmed.startsWith('Example:') ||
      trimmed.startsWith('Ejemplo:')
    ) {
      expectedIndent = 2;
      if (output.length > 0 && output[output.length - 1] !== '' && !output[output.length - 1].trim().startsWith('@')) {
        output.push('');
      }
    } else if (
      trimmed.startsWith('Given ') ||
      trimmed.startsWith('Dado ') ||
      trimmed.startsWith('When ') ||
      trimmed.startsWith('Cuando ') ||
      trimmed.startsWith('Then ') ||
      trimmed.startsWith('Entonces ') ||
      trimmed.startsWith('And ') ||
      trimmed.startsWith('Y ') ||
      trimmed.startsWith('But ') ||
      trimmed.startsWith('Pero ') ||
      trimmed.startsWith('* ')
    ) {
      expectedIndent = 4;
    } else if (trimmed.startsWith('Examples:') || trimmed.startsWith('Ejemplos:')) {
      expectedIndent = 4;
      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
    } else if (trimmed.startsWith('|')) {
      expectedIndent = 6;
    } else if (trimmed.startsWith('@')) {
      let nextIndent = 0;
      for (let j = i + 1; j < lines.length; j++) {
        const nextTrimmed = lines[j].trim();
        if (nextTrimmed === '' || nextTrimmed.startsWith('@')) continue;
        if (nextTrimmed.startsWith('Feature:') || nextTrimmed.startsWith('Característica:')) nextIndent = 0;
        else if (
          nextTrimmed.startsWith('Rule:') ||
          nextTrimmed.startsWith('Regla:') ||
          nextTrimmed.startsWith('Background:') ||
          nextTrimmed.startsWith('Antecedentes:') ||
          nextTrimmed.startsWith('Scenario:') ||
          nextTrimmed.startsWith('Escenario:') ||
          nextTrimmed.startsWith('Scenario Outline:') ||
          nextTrimmed.startsWith('Esquema del escenario:')
        )
          nextIndent = 2;
        else if (nextTrimmed.startsWith('Examples:') || nextTrimmed.startsWith('Ejemplos:')) nextIndent = 4;
        break;
      }
      expectedIndent = nextIndent;

      if (output.length > 0 && output[output.length - 1] !== '') {
        output.push('');
      }
    } else if (trimmed.startsWith('#')) {
      // Comments preserve expected indent
    } else {
      if (expectedIndent === 0) expectedIndent = 2;
    }

    output.push(' '.repeat(expectedIndent) + trimmed);
  }

  if (output.length > 0 && output[output.length - 1] !== '') {
    output.push('');
  }

  return output.join('\n');
}

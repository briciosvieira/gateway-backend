import { randomBytes, randomInt } from 'node:crypto';

const UPPERCASE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijkmnopqrstuvwxyz';
const NUMBERS = '23456789';
const SPECIAL = '@#$%&*!';

function randomCharacter(source: string): string {
  return source[randomInt(0, source.length)];
}

function shuffle(value: string): string {
  const characters = value.split('');

  for (let index = characters.length - 1; index > 0; index -= 1) {
    const randomIndex = randomInt(0, index + 1);

    [characters[index], characters[randomIndex]] = [
      characters[randomIndex],
      characters[index],
    ];
  }

  return characters.join('');
}

export function generateTemporaryPassword(): string {
  const requiredCharacters = [
    randomCharacter(UPPERCASE),
    randomCharacter(LOWERCASE),
    randomCharacter(NUMBERS),
    randomCharacter(SPECIAL),
  ];

  const randomPart = randomBytes(8).toString('base64url').replace(/[-_]/g, '');

  return shuffle(`${requiredCharacters.join('')}${randomPart}`);
}

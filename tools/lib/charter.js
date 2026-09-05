// The default charter for a new entity.
//
//   art-04/§21/¶1  every entity has a charter, which is a published document
//   art-04/§21/¶3  a charter must not be inconsistent with this Constitution
//
// Shared so the tool, the website, and the manage command all produce the same
// starting text. An entity formed on the website writes only its register entry
// — one commit link creates one file — so the charter is created afterwards,
// and this is what it is created from.

export function defaultCharter({ id, type, name, organs = [], purpose = '', today }) {
  const orgs = organs.length ? organs : [{ name: 'convenor', held_by: [] }];
  const mark = '¹²³⁴⁵⁶⁷⁸⁹';
  return `---
id: ${id}
type: ${type}
title: ${name}
formed: ${today || new Date().toISOString().slice(0, 10)}
---

## § 1  Name and type

¹ The entity is named ${name}.

² It is ${type === 'organ' ? 'an organ of the Republic' : `a ${type}`}, formed under Article 4 § 19 ¹.

## § 2  Purpose

¹ ${purpose || 'The purpose of the entity is stated by its members and may be altered by them.'}

## § 3  Membership

¹ Membership is open to any citizen on application to an organ named in § 4.

² A member may withdraw at any time by a signed record.

## § 4  Organs

${orgs.map((o, i) => `${mark[i] || i + 1} The ${o.name} is held by ${(o.held_by || []).join(', ') || 'no one at present'} and acts for the entity within the authority this charter confers.`).join('\n\n')}

## § 5  Decisions

¹ The entity decides by a majority of its members, unless this charter provides otherwise.

² Every decision is recorded and published.

## § 6  Consistency

¹ This charter is subordinate to the Constitution, and any provision inconsistent with it is of no effect — Article 4 § 21 ³.

## § 7  Dissolution

¹ The entity is dissolved by its charter's procedure, by resolution of its members, or by judgment of the Court.

² On dissolution its holdings pass to the Treasury, unless the resolution of dissolution provides otherwise — Article 4 § 23 ².
`;
}

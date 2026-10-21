import Image from "next/image";
import Link from "next/link";
import styles from "./homepage.module.css";

const characters = [
  { name: "Marlow Reed", image: "/home/marlow-reed-portrait.webp", alt: "Marlow Reed, a crocodile character in a worn brown jacket" },
  { name: "Marnie Hartwell", image: "/home/marnie-hartwell-portrait.webp", alt: "Marnie Hartwell, a dark-haired woman in a black suit with teal lapels" },
  { name: "Veyra Solvane", image: "/home/veyra-solvane-portrait.webp", alt: "Veyra Solvane, a winged fantasy character in ornate green and gold robes" },
];

/** Static visual samples; packaged artwork does not depend on the source dev game. */
export function CreationExample() {
  return <section className={styles.creation} aria-labelledby="creation-example-title">
    <h2 id="creation-example-title">Characters</h2>
    <ul className={styles.characters} tabIndex={0} aria-label="Character portraits">
      {characters.map(character => <li key={character.name}>
        <figure className={styles.character}>
          <Image src={character.image} alt={character.alt} fill sizes="(max-width: 600px) 75vw, (max-width: 1023px) 30vw, (max-width: 1920px) 15vw, 300px" />
          <figcaption><h3>{character.name}</h3></figcaption>
        </figure>
      </li>)}
    </ul>
    <Link className={styles.sectionLink} href="/agents/create">Create an agent <span aria-hidden="true">→</span></Link>
  </section>;
}

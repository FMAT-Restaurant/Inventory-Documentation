import Link from '@docusaurus/Link';
import Layout from '@theme/Layout';
import styles from './index.module.css';

const destinations = [
  {
    title: 'Requisitos',
    to: '/requisitos/',
    description:
      'Requisitos funcionales, no funcionales, criterios de aceptación, impacto e matriz de trazabilidad del microservicio de Inventario.',
    action: 'Leer los requisitos',
  },
  {
    title: 'Casos de uso',
    to: '/casos-de-uso/',
    description: 'Flujos principales, alternos y de excepción de CU-01 a CU-12.',
    action: 'Consultar los casos de uso',
  },
  {
    title: 'Test cases',
    to: '/test-cases/',
    description: 'Casos de prueba trazados a cada requisito y caso de uso.',
    action: 'Ver los test cases',
  },
  {
    title: 'API Reference',
    to: '/api/',
    description: 'Contrato OpenAPI del Inventory Backend, renderizado con Scalar.',
    action: 'Consultar la referencia API',
  },
];

export default function HomePage() {
  return (
    <Layout
      title="Inventory Service"
      description="Documentación del microservicio de Inventario de Restaurant Platform"
    >
      <main className={`container ${styles.page}`}>
        <section className={styles.hero} aria-labelledby="home-title">
          <p className={styles.eyebrow}>Documentación del microservicio de Inventario</p>
          <h1 className={styles.title} id="home-title">
            Inventory Service
          </h1>
          <p className={styles.intro}>
            Requisitos, casos de uso, test cases y la referencia del contrato de API del
            microservicio de Inventario para el sistema de restaurante/cocina.
          </p>
        </section>

        <section className={styles.destinations} aria-labelledby="destinations-title">
          <h2 className={styles.sectionTitle} id="destinations-title">
            Explora la documentación
          </h2>
          <nav aria-label="Secciones de documentación">
            <div className={styles.cards}>
              {destinations.map(({ title, to, description, action, status }) => (
                <article className={styles.card} key={to}>
                  <Link className={styles.cardLink} to={to}>
                    <div className={styles.cardHeading}>
                      <h3 className={styles.cardTitle}>{title}</h3>
                      {status && <span className={styles.cardStatus}>{status}</span>}
                    </div>
                    <p className={styles.cardDescription}>{description}</p>
                    <span className={styles.cardAction}>
                      {action}
                      <span aria-hidden="true"> →</span>
                    </span>
                  </Link>
                </article>
              ))}
            </div>
          </nav>
        </section>
      </main>
    </Layout>
  );
}

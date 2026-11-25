import Container from "@mui/material/Container";
import Typography from "@mui/material/Typography";

export default function HomePage() {
  return (
    <Container maxWidth="md" sx={{ py: 8 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Clause for Concern
      </Typography>
      <Typography color="text.secondary">
        NDA review against a fixed playbook. The review workspace is not built yet.
      </Typography>
    </Container>
  );
}

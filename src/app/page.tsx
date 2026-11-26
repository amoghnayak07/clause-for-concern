import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { APP_NAME } from "@/common/constants";
import { ReviewApp } from "@/components/review/ReviewApp";

export default function HomePage() {
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: { md: "100vh" } }}>
      <Box component="header" sx={{ px: 2, pt: 2 }}>
        <Typography variant="h5" component="h1">
          {APP_NAME}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0 }}>
        <ReviewApp />
      </Box>
    </Box>
  );
}

import siteSettings from "./siteSettings";
import page from "./page";
import collectionItem from "./collection";
import seo from "./seo";
import navItem from "./navItem";
import formSubmission from "./formSubmission";
import heroVariant from "./heroVariant";
import campaignPage from "./campaignPage";
import heroSection from "./sections/heroSection";
import featureSection from "./sections/featureSection";
import ctaSection from "./sections/ctaSection";
import richText from "./sections/richText";

export const schemaTypes = [
  siteSettings, page, collectionItem, seo, navItem,
  formSubmission, heroVariant, campaignPage,
  heroSection, featureSection, ctaSection, richText,
];

<template>
  <div class="home">
    <HeroSection />
    <DemoSection />
    <HowItWorksSection />
    <SelfHostedSection />
    <AccountsSection />
    <SecuritySection />
    <StackSection />
    <PlansSection />
    <CustomersBanner />
    <CommunitySection />
    <FaqSection />
    <FinalCta />
  </div>
</template>

<script setup lang="ts">
import AccountsSection from '../components/home/AccountsSection.vue';
import CommunitySection from '../components/home/CommunitySection.vue';
import CustomersBanner from '../components/home/CustomersBanner.vue';
import DemoSection from '../components/home/DemoSection.vue';
import FaqSection from '../components/home/FaqSection.vue';
import FinalCta from '../components/home/FinalCta.vue';
import HeroSection from '../components/home/HeroSection.vue';
import HowItWorksSection from '../components/home/HowItWorksSection.vue';
import PlansSection from '../components/home/PlansSection.vue';
import SecuritySection from '../components/home/SecuritySection.vue';
import SelfHostedSection from '../components/home/SelfHostedSection.vue';
import StackSection from '../components/home/StackSection.vue';
import { usePageHead } from '../composables/usePageHead';

usePageHead('home');
</script>
